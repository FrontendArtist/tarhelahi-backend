// path: backend/config/plugins.js

module.exports = ({ env }) => {
  // اگر در محیط لوکال باشیم (و صریحاً UPLOAD_PROVIDER=aws-s3 تعیین نشده باشد)، آپلود روی دیسک لوکال انجام می‌شود
  const isProduction = env('NODE_ENV') === 'production';
  const uploadProvider = env('UPLOAD_PROVIDER', isProduction ? 'aws-s3' : 'local');
  const hasLiaraCredentials = !!env('LIARA_ACCESS_KEY_ID') && !!env('LIARA_ACCESS_SECRET');

  if (uploadProvider !== 'aws-s3' || !hasLiaraCredentials) {
    // حالت لوکال: ذخیره عکس‌ها در پوشه public/uploads دیسک محلی
    return {};
  }

  // حالت پروداکشن / لیارا: آپلود مستقیم روی باکت آبجکت استوریج لیارا
  return {
    upload: {
      config: {
        provider: 'aws-s3',
        providerOptions: {
          baseUrl: env('LIARA_BASE_URL', 'https://dl.tarhelahi.ir/media'),
          s3Options: {
            credentials: {
              accessKeyId: env('LIARA_ACCESS_KEY_ID'),
              secretAccessKey: env('LIARA_ACCESS_SECRET'),
            },
            region: env('LIARA_REGION', 'default'),
            endpoint: env('LIARA_ENDPOINT', 'https://storage.c2.liara.site'),
            rootPath: 'media',
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
  };
};