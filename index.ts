import { serve } from 'bun'
import { Hono } from 'hono'
import {  GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { testR2Connection } from './cloudflare/testR2Connection';
import { createBuildRoute } from './routes/post/build';
import { createDocsRoute } from './routes/post/docs';
import { getSubdomain } from './utils/getSubdomain';

const app = new Hono()

const bucketName = "ai-doc-automation"
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
  requestHandler: {
    // @ts-ignore - Bun specific timeout configuration
    requestTimeout: 30000,
    connectionTimeout: 10000,
  },
  maxAttempts: 3,
  retryMode: 'adaptive',
});

export const repos = "staging/project-repos/"

//MULTI-TENANT
app.use('*', async (c, next) => {
  const hostname = new URL(c.req.url).hostname;
  const subdomain = getSubdomain(hostname)

  if (subdomain && subdomain !== 'api') {
    //TODO: check if the project exists, if not throw error
    console.log(`MULTI-TENANT MODE: Request for tenant '${subdomain}'`);

    let requestedFile = new URL(c.req.url).pathname;

    if (requestedFile.endsWith('/')) {
      requestedFile += 'index.html';
    }

    const key = `${repos}${subdomain}/build${requestedFile}`;

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

app.post('/build', createBuildRoute({ r2, bucketName }));
app.post('/docs', createDocsRoute({ r2, bucketName }));

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

const server = serve({
  fetch: app.fetch,
  port: 3001,
});

console.log(`Server listening on port ${server.port}`);
