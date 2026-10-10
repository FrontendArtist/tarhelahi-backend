const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: '.env' });

const client = new S3Client({
  region: process.env.LIARA_REGION || 'default',
  endpoint: process.env.LIARA_ENDPOINT || 'https://storage.c2.liara.site',
  credentials: {
    accessKeyId: process.env.LIARA_ACCESS_KEY_ID,
    secretAccessKey: process.env.LIARA_ACCESS_SECRET,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.LIARA_BUCKET || 'tarhelahicloud';

const corsConfig = {
  CORSRules: [
    {
      ID: 'tarhelahi-audio-fetch',
      AllowedOrigins: ['*'],
      AllowedMethods: ['GET', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['Content-Length', 'Content-Type', 'Content-Range', 'Accept-Ranges'],
      MaxAgeSeconds: 86400,
    },
  ],
};

async function setCors() {
  console.log('Setting CORS for bucket:', BUCKET);
  try {
    const res = await client.send(new PutBucketCorsCommand({ Bucket: BUCKET, CORSConfiguration: corsConfig }));
    console.log('CORS Policy applied successfully!', res);
    const result = await client.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
    console.log('Current CORS rules:', JSON.stringify(result.CORSRules, null, 2));
  } catch (err) {
    console.error('Error setting CORS name:', err.name);
    console.error('Error message:', err.message);
    console.error('Raw response:', err..statusCode, err..body?.toString?.());
    console.error('Error full:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    process.exit(1);
  }
}

setCors();
