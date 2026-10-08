# بک‌اند طرح الهی

سرویس محتوایی Strapi 5 طرح الهی. برای اجرای محلی، تنظیمات محیطی پروژه را آماده کنید و سپس:

```bash
npm install
npm run dev
```

برای ساخت و آزمون از `npm run build` و `npm test` استفاده کنید. اسکریپت‌های دیگر در `package.json` آمده‌اند.

## اتصال به بای‌مانی

مسیرهای خواندن سرویس به سرویس زیر در `/api/integrations/byemoney/v1/` قرار دارند و با هدر `X-Service-Key` محافظت می‌شوند:

- `GET /users/:externalUserId`
- `GET /courses/:externalId`

شناسهٔ خارجی در هر دو مسیر `documentId` است. مرز مالکیت داده، DTO و قواعد احراز هویت را از [قرارداد اتصال](../../ByeMoney/docs/integration/ByeMoney-Strapi-Integration.md) بخوانید؛ متن این README مرجع موازی قرارداد نیست.

[تصمیم‌های بای‌مانی](../../ByeMoney/docs/architecture/ByeMoney-Decisions.md)، [موارد پیگیری مشترک](../../ByeMoney/TASKS.md) و [تاریخچهٔ تغییرات](CHANGELOG.md) نیز در دسترس‌اند.
