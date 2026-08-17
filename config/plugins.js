// path: backend/config/plugins.js

module.exports = ({ env }) => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        baseUrl: env('LIARA_BASE_URL', 'https://dl.tarhelahi.ir'),
        s3Options: {
          credentials: {
            accessKeyId: env('LIARA_ACCESS_KEY_ID'),
            secretAccessKey: env('LIARA_ACCESS_SECRET'),
          },
          region: env('LIARA_REGION', 'default'),
          endpoint: env('LIARA_ENDPOINT', 'https://storage.c2.liara.site'),
          params: {
            Bucket: env('LIARA_BUCKET', 'tarhelahicloud'),
            ACL: env('AWS_ACL', 'public-read'),
          },
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
});