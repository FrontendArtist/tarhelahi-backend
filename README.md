# بک‌اند طرح الهی

سرویس هویت، محتوا و کاتالوگ طرح الهی با Strapi. نسخهٔ دقیق وابستگی‌ها و محدودهٔ Node/npm در [package.json](package.json) و فایل قفل نگهداری می‌شوند.

## اجرای محلی

اتصال پایگاه توسعه و متغیرهای محیطی را مطابق فایل‌های `config/` آماده کنید؛ سپس از ریشهٔ مخزن:

```powershell
npm ci
npm run dev
```

ساخت: `npm run build`؛ اجرای نسخهٔ ساخته‌شده: `npm start`. تنظیمات محیط مقصد و migrationها پیش از انتشار جداگانه بررسی شوند.

`JWT_SECRET` دست‌کم ۳۲ بایت است و هر دو شاخهٔ `config/plugins.js` آن را صریح می‌خوانند. در توسعه، بارگذاری پیش‌فرض روی دیسک محلی است؛ انتخاب aws-s3 و کلیدهای سرویس از env انجام می‌شود. نام متغیرها و رفتار واقعی از `config/plugins.js` و `config/database.js` خوانده شوند؛ secret در مستندات یا Git قرار نگیرد.

## نقاط شروع کد

| موضوع | مسیر |
|---|---|
| APIهای اتصال و پیش‌نمایش سبد | [routes](src/api/integration/routes/integration.js) و [controller](src/api/integration/controllers/integration.js) |
| قیمت، رزرو کوپن و تحویل سبد | [byeMoneyCartService](src/services/byeMoneyCartService.js) |
| تحویل تک‌دوره و کنترل تکرار | [byeMoneyPurchaseService](src/services/byeMoneyPurchaseService.js) |
| احراز هویت سرویس | [is-service-authenticated](src/policies/is-service-authenticated.js) |
| سفارش‌های قدیمی و موجودی | [order controller](src/api/order/controllers/order.js) و [lifecycle](src/api/order/content-types/order/lifecycles.js) |
| migrationهای پروژه | `database/migrations/` |
| بازیابی و رسیدگی درگاه | `src/services/` و آزمون‌های `tests/services/` |

قرارداد API، نگاشت DTO و کلیدهای دو جهت در [Integration](../../ByeMoney/docs/integration/ByeMoney-Strapi-Integration.md) است. فهرست مسیرها اینجا تکرار نمی‌شود. وجود endpoint کاتالوگ، آمادگی خرید مالی فصل/کالا یا انتشار را اثبات نمی‌کند.

## آزمون

فایل‌های این مخزن دو اجراکننده دارند؛ اجرای همه با Jest نتیجهٔ معتبر یکپارچه نیست:

```powershell
npm test -- --runInBand tests/api tests/services tests/config
node --test tests/order-price-hotfix.test.js tests/pending-checkout.test.js tests/abandoned-order.test.js
```

آزمون‌های PostgreSQL مستقل: `tests/order-price-hotfix.pg.test.js` و `tests/pending-checkout.pg.test.js` به `ORDER_PRICE_TEST_DB` با پیکربندی JSON اتصال آزمایشی نیاز دارند؛ `tests/byeMoneyCart.pg.cjs` با `BYEMONEY_CART_PG_TESTS=1` فعال می‌شود. آن‌ها با `node --test` اجرا شوند. استفاده از پایگاه آزمایشی الزامی است؛ اجرا‌نشدن آزمون مشروط، قبولی نیست. این فرمان‌ها در بازبینی اسناد اجرا نشده‌اند.

## مراجع مشترک

[راهنمای اسناد](../../ByeMoney/docs/README.md)، [تصمیم‌ها](../../ByeMoney/docs/architecture/ByeMoney-Decisions.md)، [کارهای باز](../../ByeMoney/TASKS.md)، [باگ‌های محمد](../../ByeMoney/HOTFIXES.md) و [شواهد آزمون](../../ByeMoney/docs/testing/Verification-Summary.md).

شرح تغییرات انجام‌شده در Git نگهداری می‌شود. برای شاخه‌ها CHANGELOG اجرایی، فهرست تسک یا قرارداد موازی نسازید؛ وضعیت master، شاخهٔ اتصال و محیط مستقر جدا ثبت شود.
