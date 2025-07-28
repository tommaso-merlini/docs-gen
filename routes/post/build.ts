import { z } from 'zod';
import { S3Client } from '@aws-sdk/client-s3';
import { upload } from '../../cloudflare/upload';
import { download } from '../../cloudflare/download';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from 'hono';

const projectNameSchema = z.object({
  projectName: z.string().min(1, 'Project name is required')
});

// Helper to execute a command and throw if it fails
const runCommand = (command: string[], cwd: string) => {
  console.log(`Running command: "${command.join(' ')}" in ${cwd}`);
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  if (result.exitCode !== 0) {
    // Throwing an error will be caught by the try-catch block
    throw new Error(
      `Command "${command.join(' ')}" failed with exit code ${result.exitCode}`
    );
  }
};

interface BuildRouteConfig {
  r2: S3Client;
  bucketName: string;
}

export const createBuildRoute = (config: BuildRouteConfig) => {
  return async (c: Context) => {
    const body = await c.req.parseBody();
    const validation = projectNameSchema.safeParse({
      projectName: body['projectName']
    });

    if (!validation.success) {
      return c.json({
        ok: false,
        error: validation.error
      }, 400);
    }

    const { projectName } = validation.data;

    let tempDir: string | null = null;

    try {
      tempDir = mkdtempSync(join(tmpdir(), 'project-build-'));
      console.log(`Created temporary directory for build: ${tempDir}`);

      console.log(`Fetching project '${projectName}' from R2...`);
      await download(config.r2, config.bucketName, projectName, tempDir, [`${projectName}/build/`]);
      console.log(`Project '${projectName}' downloaded successfully.`);

      const projectPath = join(tempDir, projectName);

      // Run build steps, throwing on failure
      runCommand(['bun', 'install'], projectPath);
      runCommand(['bun', 'run', 'build'], projectPath);
      runCommand(['rm', '-rf', 'node_modules'], projectPath);

      await upload(
        config.r2,
        `${projectPath}/build`,
        `${projectName}/build`,
        config.bucketName
      );

      return c.json({
        ok: true,
        message: 'Build and upload successful',
        projectName
      });

    } catch (error) {
      console.error(`A critical error occurred during the build process for '${projectName}':`, error);
      return c.json({
        ok: false,
        error: 'An error occurred during the build or upload process'
      }, 500);
    } finally {
      if (tempDir) {
        try {
          rmSync(tempDir, {
            recursive: true,
            force: true
          });
          console.log(`Successfully cleaned up temporary directory: ${tempDir}`);
        } catch (cleanupError) {
          console.error(`CRITICAL: Failed to clean up temporary directory ${tempDir}. Manual intervention may be required.`, cleanupError);
        }
      }
    }
  };
};
