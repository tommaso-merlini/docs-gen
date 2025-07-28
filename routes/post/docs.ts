import { z } from 'zod';
import { S3Client } from '@aws-sdk/client-s3';
import { upload } from '../../cloudflare/upload';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from 'hono';

const projectNameSchema = z.object({
  projectName: z.string().min(1, 'Project name is required')
});

interface DocsRouteConfig {
  r2: S3Client;
  bucketName: string;
}

export const createDocsRoute = (config: DocsRouteConfig) => {
  return async (c: Context) => {
    const body = await c.req.json();
    const validation = projectNameSchema.safeParse(body);
    
    if (!validation.success) {
      return c.json({ 
        ok: false, 
        error: validation.error
      }, 400);
    }
    
    const { projectName } = validation.data;

    let tempBuildDir: string | null = null;

    try {
      tempBuildDir = mkdtempSync(join(tmpdir(), 'docusaurus-build-'));
      console.log(`[API] Created temporary directory: ${tempBuildDir}`);
      
      const projectPath = join(tempBuildDir, projectName);

      Bun.spawnSync(
        ['bunx', 'create-docusaurus@latest', projectName, 'classic', '--typescript'],
        {
          cwd: tempBuildDir,
          stdout: 'inherit',
          stderr: 'inherit',
          env: { ...process.env },
        }
      );
      // Bun.spawnSync(['bun', 'run', 'build'], { cwd: projectPath, stdout: 'inherit', stderr: 'inherit' });
      Bun.spawnSync(['rm', '-rf', 'node_modules'], { cwd: projectPath, stdout: 'inherit', stderr: 'inherit' });

      await upload(
        config.r2,
        projectPath,
        projectName,
        config.bucketName
      );

      return c.json({ 
        ok: true, 
        message: 'Project created and uploaded successfully',
        projectName
      });

    } catch (error) {
      console.error(`[API] A critical error occurred during the process:`, error);
      return c.json({ 
        ok: false, 
        error: 'An error occurred during the build or upload process' 
      }, 500);
    } finally {
      if (tempBuildDir) {
        try {
          rmSync(tempBuildDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error(`[API] CRITICAL: Failed to clean up temporary directory ${tempBuildDir}. Manual intervention may be required.`, cleanupError);
        }
      }
    }
  };
};
