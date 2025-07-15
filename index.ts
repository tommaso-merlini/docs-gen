import { serve } from 'bun'
import { Hono } from 'hono'
import { GetObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3';
import { upload } from './cloudflare/upload';
import { testR2Connection } from './cloudflare/testR2Connection';
import { getSubdomain } from './utils/getSubdomain';
import { mkdtempSync, rmSync } from 'node:fs'; // Use Node.js FS module, natively supported by Bun
import { tmpdir } from 'node:os'; // To get the OS's temp directory path
import { join } from 'node:path'; // For creating paths safely
import { download } from './cloudflare/download';

const app = new Hono()

const bucketName = "ai-doc-automation"
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
});

//MULTI-TENANT
app.use('*', async (c, next) => {
  const hostname = new URL(c.req.url).hostname;
  const subdomain = getSubdomain(hostname)

  if (subdomain && subdomain !== 'www') {
    //TODO: check if the project exists, if not throw error
    console.log(`MULTI-TENANT MODE: Request for tenant '${subdomain}'`);

    let requestedFile = new URL(c.req.url).pathname;

    if (requestedFile.endsWith('/')) {
      requestedFile += 'index.html';
    }

    const key = `${subdomain}/build${requestedFile}`;

    console.log(`Attempting to fetch from R2 with key: ${key}`);

    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      const object = await r2.send(command);

      if (object.Body) {
        if (object.ContentType) {
          c.header('Content-Type', object.ContentType);
        }
        if (object.ETag) {
          c.header('ETag', object.ETag);
        }
        if (object.ContentLength) {
          c.header('Content-Length', object.ContentLength.toString());
        }

        return c.body(object.Body as any);
      }
    } catch (error) {
      return c.text('Not Found', 404);
    }
  }

  await next();
});

//BUILD A DOC ON R2
app.post('/build', async (c) => {
  const body = await c.req.parseBody();
  const projectName = body['projectName'];
  
  if (typeof projectName !== 'string' || !projectName) {
    return c.text('Invalid projectName provided.', 400);
  }

  let tempDir: string | null = null;

  try {
    tempDir = mkdtempSync(join(tmpdir(), 'project-build-'));
    console.log(`Created temporary directory for build: ${tempDir}`);
    
    console.log(`Fetching project '${projectName}' from R2...`);
    await download(r2, bucketName, projectName, tempDir);
    console.log(`Project '${projectName}' downloaded successfully.`);
    
    const projectPath = join(tempDir, projectName);

    Bun.spawnSync(['bun', 'install'], { cwd: projectPath, stdout: 'inherit', stderr: 'inherit' });
    Bun.spawnSync(['bun', 'run', 'build'], { cwd: projectPath, stdout: 'inherit', stderr: 'inherit' });
    Bun.spawnSync(['rm', '-rf', 'node_modules'], { cwd: projectPath, stdout: 'inherit', stderr: 'inherit' });

    await upload(
      r2,
      `${projectPath}/build`,
      `${projectName}/build`,
      bucketName
    );

    return c.text('Build and upload successful.');

  } catch (error) {
    console.error(`A critical error occurred during the build process for '${projectName}':`, error);
    return c.text('An error occurred during the build or upload process.', 500);
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
        console.log(`Successfully cleaned up temporary directory: ${tempDir}`);
      } catch (cleanupError) {
        console.error(`CRITICAL: Failed to clean up temporary directory ${tempDir}. Manual intervention may be required.`, cleanupError);
      }
    }
  }
});

//CREATE A DOC AND UPLOAD IT TO R2 WITHOUT BUILDING IT
app.post('/docs', async (c) => {
  const body = await c.req.parseBody();
  const projectName = body['projectName'];
  
  if (typeof projectName !== 'string' || !projectName) {
    return c.text('Invalid projectName provided.', 400);
  }

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
      r2,
      projectPath,
      projectName,
      bucketName
    );

    return c.text('Build and upload successful.');

  } catch (error) {
    console.error(`[API] A critical error occurred during the process:`, error);
    return c.text('An error occurred during the build or upload process.', 500);
  } finally {
    if (tempBuildDir) {
      try {
        rmSync(tempBuildDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error(`[API] CRITICAL: Failed to clean up temporary directory ${tempBuildDir}. Manual intervention may be required.`, cleanupError);
      }
    }
  }
});

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.get('/test-r2', async (c) => {
  const result = await testR2Connection(r2, bucketName);
  
  if (result.success) {
    console.log(`✓ ${result.message}`);
    return c.json({ 
      status: 'success', 
      message: result.message,
      details: result.details 
    });
  } else {
    console.error(`✗ ${result.message}`);
    return c.json({ 
      status: 'error', 
      message: result.message,
      details: result.details 
    }, result.details?.statusCode === 403 ? 403 : 404);
  }
});

serve({
  fetch: app.fetch,
  port: 3001
})
