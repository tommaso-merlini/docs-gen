import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

export async function download(client: S3Client, bucket: string, prefix: string, downloadPath: string): Promise<void> {
  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    });

    const listedObjects = await client.send(listCommand);

    if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
      console.log(`No objects found with prefix: ${prefix}`);
      return;
    }

    for (const object of listedObjects.Contents) {
      if (!object.Key) continue;
      
      const filePath = join(downloadPath, object.Key);
      const dir = dirname(filePath);

      mkdirSync(dir, { recursive: true });
      
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: object.Key,
      });

      const objectData = await client.send(getObjectCommand);

      if (objectData.Body) {
        const fileStream = objectData.Body as any;
        const fileBuffer = await new Response(fileStream).arrayBuffer();
        writeFileSync(filePath, Buffer.from(fileBuffer));
      }
    }
  } catch (error) {
    console.error(`Error downloading from R2 with prefix ${prefix}:`, error);
    throw error;
  }
}
