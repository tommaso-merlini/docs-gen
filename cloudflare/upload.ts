import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readdir, stat } from "fs/promises";
import { join, relative } from "path";

export async function upload(r2: S3Client, localPath: string, r2Prefix: string = "", bucketName: string): Promise<void> {
  // Get all files recursively
  const files = await getAllFiles(localPath);
  
  console.log(`Found ${files.length} files to upload`);

  // Upload each file
  const uploadPromises = files.map(async (filePath) => {
    const relativePath = relative(localPath, filePath);
    const r2Key = r2Prefix ? `${r2Prefix}/${relativePath}` : relativePath;
    
    try {
      // Read file using Bun
      const file = Bun.file(filePath);
      const fileBuffer = await file.arrayBuffer();
      
      // Upload to R2 using AWS SDK v3
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: r2Key.replace(/\\/g, '/'), // Ensure forward slashes for R2
        Body: new Uint8Array(fileBuffer),
        ContentType: getContentType(filePath),
      });

      await r2.send(command);
      console.log(`✓ Uploaded: ${relativePath}`);
    } catch (error) {
      console.error(`✗ Failed to upload ${relativePath}:`, error);
      throw error;
    }
  });

  // Wait for all uploads to complete
  await Promise.all(uploadPromises);
  console.log(`Successfully uploaded ${files.length} files to R2`);
}

async function getAllFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  
  async function traverse(currentPath: string) {
    const entries = await readdir(currentPath);
    
    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const stats = await stat(fullPath);
      
      if (stats.isDirectory()) {
        await traverse(fullPath);
      } else if (stats.isFile()) {
        files.push(fullPath);
      }
    }
  }
  
  await traverse(dirPath);
  return files;
}

function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  const mimeTypes: Record<string, string> = {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
  };
  
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

