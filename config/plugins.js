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
          // baseUrl: پایه URL که Strapi برای ساخت آدرس فایل استفاده می‌کند.
          // بدون rootPath، S3 provider از file.path مستقیماً استفاده می‌کند.
          // URL نهایی = baseUrl + '/' + file.path + '/' + hash + ext
          // مثال: https://api.tarhelahi.ir/media/products/hash.jpg
          // مثال: https://api.tarhelahi.ir/receipts/order-abc/hash.jpg
          baseUrl: env('LIARA_BASE_URL', 'https://dl.tarhelahi.ir'),
          // rootPath حذف شد - مسیرها از طریق file.path در bootstrap middleware تنظیم می‌شوند
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
  };
};