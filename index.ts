import { serve } from 'bun'
import { Hono } from 'hono'
import { $ } from 'bun';
import { S3Client } from '@aws-sdk/client-s3';
import { upload } from './cloudflare/upload';
import { testR2Connection } from './cloudflare/testR2Connection';
import { getSubdomain } from './utils/getSubdomain';
import { serveStatic } from 'hono/bun';

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

app.use('*', async (c, next) => {
  const hostname = new URL(c.req.url).hostname;
  const subdomain = getSubdomain(hostname)

  if (subdomain && subdomain !== 'www') {
    //TODO: check if the project exists, if not throw error
    console.log(`MULTI-TENANT MODE: Request for tenant '${subdomain}'`);
    const tenantRoot = `./docs/${subdomain}/build`;
    const staticServer = serveStatic({
      root: tenantRoot,
      // TODO: serve 'index.html' for directory requests (e.g., /)
      onNotFound: (path: string, c: any) => {
        console.log(`type of path: ${typeof path} | type of c: ${typeof c}`)
        console.log(`File not found for tenant '${subdomain}': ${path}`);
        return c.text('Not Found', 404);
      }
    });

    return staticServer(c, next);
  }

  await next();
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

app.post('/docs', async (c) => {
  const body = await c.req.parseBody()
  const projectName = body["projectName"]
  const projectDirectory = "./docs" 
  const projectPath = `${projectDirectory}/${projectName}`
  
  if(typeof projectName != "string") {
    return c.text("error")
  }

  try {
    Bun.spawnSync(
      ['bunx', 'create-docusaurus@latest', projectName, 'classic', '--typescript'],
      {
        cwd: projectDirectory,
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...process.env },
      }
    );

    //NOTE: these two procs could be done in parallel
    Bun.spawnSync(
      ['bun', 'run', 'build'],
      {
        cwd: projectPath,
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...process.env },
      }
    );

    Bun.spawnSync(
      ['rm', '-rf', 'node_modules'],
      {
        cwd: projectPath,
        stdout: 'inherit',
        stderr: 'inherit',
      }
    );
  } catch (error) {
    console.error(`[API] An unexpected error occurred during spawn for ${projectName}:`, error);
    return c.text("An unexpected server error occurred.", 500);
  }

  
  // try {
  //   await upload(
  //       r2,
  //     `${projectPath}`,
  //     projectName,
  //     bucketName
  //   );
  // } catch (error) {
  //   console.error("Upload failed:", error);
  //   return c.text("Upload failed", 500);
  // }
  
  return c.text("ok")
})

serve({
  fetch: app.fetch,
  port: 3001
})
