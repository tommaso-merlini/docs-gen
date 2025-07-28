import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

// Constants for timeouts
const REQUEST_TIMEOUT = 30000; // 30 seconds
const CONNECTION_TIMEOUT = 10000; // 10 seconds

export async function download(
  client: S3Client, 
  bucket: string, 
  prefix: string, 
  downloadPath: string,
  excludePatterns?: string[]
): Promise<void> {
  try {
    console.log('1. Starting download process...');
    console.log(`   Bucket: ${bucket}`);
    console.log(`   Prefix: ${prefix}`);
    console.log(`   Download Path: ${downloadPath}`);

    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    });

    console.log('2. Sending request to R2...');
    
    // Add timeout wrapper to prevent hanging
    const listedObjects = await Promise.race([
      client.send(listCommand),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT)
      )
    ]);

    console.log('3. Response received from R2');

    if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
      console.log(`No objects found with prefix: ${prefix}`);
      return;
    }

    console.log(`4. Found ${listedObjects.Contents.length} objects to download`);

    let downloadedCount = 0;
    for (const object of listedObjects.Contents) {
      if (!object.Key) continue;
      
      // Skip files that match exclude patterns
      if (excludePatterns) {
        const shouldExclude = excludePatterns.some(pattern => 
          object.Key!.includes(pattern)
        );
        if (shouldExclude) {
          console.log(`Skipping excluded file: ${object.Key}`);
          continue;
        }
      }

      const filePath = join(downloadPath, object.Key);
      const dir = dirname(filePath);

      mkdirSync(dir, { recursive: true });
      
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: object.Key,
      });

      console.log(`Downloading: ${object.Key} -> ${filePath}`);
      
      // Add timeout to individual file downloads too
      const objectData = await Promise.race([
        client.send(getObjectCommand),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`File download timeout after ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT)
        )
      ]);

      if (objectData.Body) {
        const fileStream = objectData.Body as any;
        const fileBuffer = await new Response(fileStream).arrayBuffer();
        writeFileSync(filePath, Buffer.from(fileBuffer));
        downloadedCount++;
        
        if (downloadedCount % 5 === 0) {
          console.log(`Progress: Downloaded ${downloadedCount}/${listedObjects.Contents.length} files...`);
        }
      }
    }

    console.log(`5. Download completed! Downloaded ${downloadedCount} files`);
    
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      console.error(`6. TIMEOUT ERROR: ${error.message}`);
      console.error('   This might be due to network issues or R2 connectivity problems');
    } else {
      console.error(`6. ERROR downloading from R2 with prefix ${prefix}:`, error);
    }
    throw error;
  }
}
