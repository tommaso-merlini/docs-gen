import { HeadBucketCommand, ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";

export async function testR2Connection(r2: S3Client, bucketName: string): Promise<{ success: boolean, message: string, details?: any }> {
  console.log('Testing R2 connection...');
  console.log('Endpoint:', process.env.R2_ENDPOINT);
  console.log('Bucket:', bucketName);
  console.log('Access Key:', process.env.R2_ACCESS_KEY?.substring(0, 8) + '...');
  
  try {
    // First, try to list buckets to test basic connectivity
    console.log('Step 1: Testing basic connectivity...');
    const listCommand = new ListBucketsCommand({});
    const listResult = await r2.send(listCommand);
    
    console.log('✓ Successfully connected to R2');
    console.log('Available buckets:', listResult.Buckets?.map(b => b.Name) || []);
    
    // Check if our specific bucket exists
    const bucketExists = listResult.Buckets?.some(bucket => bucket.Name === bucketName);
    
    if (!bucketExists) {
      return {
        success: false,
        message: `Bucket '${bucketName}' does not exist`,
        details: {
          availableBuckets: listResult.Buckets?.map(b => b.Name) || []
        }
      };
    }
    
    // Now test the specific bucket
    console.log('Step 2: Testing bucket access...');
    const headCommand = new HeadBucketCommand({
      Bucket: bucketName
    });
    
    await r2.send(headCommand);
    
    return { 
      success: true, 
      message: `Successfully connected to R2 bucket: ${bucketName}`,
      details: {
        availableBuckets: listResult.Buckets?.map(b => b.Name) || []
      }
    };
    
  } catch (error: any) {
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      statusCode: error.$metadata?.httpStatusCode,
      fault: error.$fault
    });
    
    let errorMessage = `Failed to connect to R2: ${error.message}`;
    
    if (error.$metadata?.httpStatusCode === 404) {
      errorMessage = `Bucket '${bucketName}' not found. Please check the bucket name or create the bucket first.`;
    } else if (error.$metadata?.httpStatusCode === 403) {
      errorMessage = 'Access denied. Please check your R2 credentials and permissions.';
    } else if (error.name === 'NetworkingError') {
      errorMessage = 'Network error. Please check your R2 endpoint URL.';
    }
    
    return { 
      success: false, 
      message: errorMessage,
      details: {
        errorName: error.name,
        statusCode: error.$metadata?.httpStatusCode,
        fault: error.$fault
      }
    };
  }
}

