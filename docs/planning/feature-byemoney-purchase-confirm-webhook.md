# Implementation Plan: ByeMoney Purchase Confirmation Webhook

## وضعیت

این سند فقط artifact مرحله‌ی Plan است. در این مرحله هیچ endpoint، content-type، تست یا dependency جدیدی پیاده‌سازی نشده است.

- Repository: `tarhelahi-backend`
- Base branch: `byeMoney`
- شاخه‌ی پیشنهادی برای Execute: `feature/byemoney-purchase-confirm-webhook`
- Endpoint: `POST /api/integrations/byemoney/v1/purchases/confirm`

## یافته‌های بررسی کد موجود

### قرارداد احراز هویت و integration

- routeهای فعلی در `src/api/integration/routes/integration.js` با `auth: false` و policy `global::is-service-authenticated` ثبت شده‌اند.
- policy موجود در `src/policies/is-service-authenticated.js` هدر `X-Service-Key` را با `BYEMONEY_SERVICE_KEY` و مقایسه‌ی constant-time بررسی می‌کند.
- routeهای GET فعلی نباید حذف یا تغییر رفتاری داده شوند؛ route جدید باید به همان آرایه اضافه شود.
- شناسه‌ی خارجی user و course در integration موجود، `documentId` است؛ endpoint جدید نیز باید فقط با همین شناسه lookup کند.

### سازوکار واقعی اعطای دسترسی دوره

در `src/api/course/content-types/course/schema.json`، relation زیر وجود دارد:

```json
"users_permissions_users": {
  "type": "relation",
  "relation": "manyToMany",
  "target": "plugin::users-permissions.user",
  "inversedBy": "courses"
}
```

در `src/api/order/content-types/order/lifecycles.js` نیز همین relation از سمت Course خوانده و با شناسه‌های عددی داخلی merge می‌شود:

```js
const existingUserIds = (course.users_permissions_users || []).map((u) => u.id).filter(Boolean);
const mergedUserIds = [...new Set([...existingUserIds, userId])];

await strapi.db.query('api::course.course').update({
  where: { id: courseId },
  data: { users_permissions_users: mergedUserIds },
});
```

بنابراین implementation باید همین relation `users_permissions_users` را، پس از lookup بر اساس `documentId`، به‌روزرسانی کند. `enrolledChapters` در lifecycle فقط برای خرید chapter استفاده می‌شود و برای این webhook که `courseId` کامل دریافت می‌کند، نباید تغییر کند.

## فایل‌های پیشنهادی برای ایجاد یا تغییر

### ایجاد

1. `src/api/byemoney-purchase-log/content-types/byemoney-purchase-log/schema.json`
   - content-type کوچک و فقط برای ثبت idempotency/conflict.
2. `src/api/integration/services/purchase-confirmation.js`
   - منطق lookup، conflict detection، grant و ثبت log.
3. `tests/unit/api/integration/purchase-confirmation.test.js`
   - تست unit با mock برای `strapi.db.query`.
4. `jest.config.js` یا معادل آن، در صورتی که configuration موجود پروژه برای Jest پیدا نشود.

### تغییر

1. `src/api/integration/routes/integration.js`
   - فقط افزودن route جدید؛ routeهای GET موجود بدون تغییر باقی بمانند.
2. `src/api/integration/controllers/integration.js`
   - افزودن action `confirmPurchase` که payload را به service واگذار کند و response/status HTTP را بسازد.
3. `package.json`
   - افزودن script اجرای Jest و dependencyهای test فقط در صورت نبود setup موجود.
4. `package-lock.json`
   - فقط در صورت تغییر واقعی dependencyها.

## Schema پیشنهادی content-type

مسیر Strapi:

```text
src/api/byemoney-purchase-log/content-types/byemoney-purchase-log/schema.json
```

UID پیشنهادی:

```text
api::byemoney-purchase-log.byemoney-purchase-log
```

attributes پیشنهادی:

```json
{
  "kind": "collectionType",
  "collectionName": "byemoney_purchase_logs",
  "info": {
    "singularName": "byemoney-purchase-log",
    "pluralName": "byemoney-purchase-logs",
    "displayName": "ByeMoney Purchase Log"
  },
  "options": {
    "draftAndPublish": false
  },
  "pluginOptions": {},
  "attributes": {
    "purchaseId": {
      "type": "string",
      "required": true,
      "unique": true
    },
    "strapiUserId": {
      "type": "string",
      "required": true
    },
    "courseId": {
      "type": "string",
      "required": true
    },
    "status": {
      "type": "enumeration",
      "enum": ["processed"],
      "required": true,
      "default": "processed"
    }
  }
}
```

`createdAt` توسط Strapi برای content-type نگهداری می‌شود و نباید به‌صورت دستی به attribute تکراری تبدیل شود. در صورت نیاز به صراحت در DTO یا تست، مقدار `createdAt` رکورد ساخته‌شده بررسی می‌شود.

## Route و controller

به `src/api/integration/routes/integration.js` این route اضافه می‌شود:

```js
{
  method: 'POST',
  path: '/integrations/byemoney/v1/purchases/confirm',
  handler: 'integration.confirmPurchase',
  config: {
    auth: false,
    policies: ['global::is-service-authenticated'],
  },
}
```

در `confirmPurchase`:

1. body از `ctx.request.body` خوانده شود.
2. service فراخوانی شود؛ controller نباید منطق query یا relation را در خود نگه دارد.
3. نتیجه با contract مشترک به شکل زیر برگردد:

```json
{
  "success": true,
  "purchaseId": "purchase_123",
  "status": "granted"
}
```

Mapping HTTP:

- payload نامعتبر: `400` و `status: "error"` با `message` واضح.
- user یا course موجود نیست: `404` و `status: "error"`؛ در این حالت log ساخته نشود.
- purchaseId موجود با user/course متفاوت: `409` و `status: "conflict"`.
- grant اول: `200` و `status: "granted"`.
- replay با همان purchaseId/user/course: `200` و `status: "already_granted"`.
- خطای پیش‌بینی‌نشده: `500` و `status: "error"`؛ جزئیات حساس در response افشا نشود.

## Service structure و ترتیب منطق

`src/api/integration/services/purchase-confirmation.js` باید یک service کوچک با مسئولیت‌های جدا داشته باشد، برای نمونه:

- `validatePayload(payload)` — بررسی کند هر سه مقدار `purchaseId`، `strapiUserId` و `courseId` از نوع string و پس از trim غیرخالی باشند.
- `findPurchaseLog(purchaseId)` — lookup روی UID log با `where: { purchaseId }`.
- `findUserByDocumentId(strapiUserId)` — query روی `plugin::users-permissions.user` با `where: { documentId: strapiUserId }`.
- `findCourseByDocumentId(courseId)` — query روی `api::course.course` با `where: { documentId: courseId }` و populate کردن `users_permissions_users`.
- `grantCourseAccess(course, user)` — merge امن شناسه‌ی عددی داخلی user با relation موجود و update از سمت Course؛ duplicate relation ایجاد نشود.
- `createProcessedLog(payload)` — ایجاد log با status `processed`.
- `confirmPurchase(payload)` — orchestration سطح بالا.

ترتیب `confirmPurchase`:

1. validate payload؛ در خطای validation هیچ query یا write انجام نشود.
2. lookup log بر اساس `purchaseId`.
3. اگر log پیدا شد و هر دو شناسه یکسان بودند، بدون grant یا write، `already_granted` برگردد.
4. اگر یکی از شناسه‌ها متفاوت بود، `conflict` برگردد.
5. اگر log پیدا نشد، user و course با `documentId` lookup شوند؛ نبود هرکدام `404` بدهد و log ساخته نشود.
6. relation `course.users_permissions_users` با user داخلی merge و update شود.
7. log با `purchaseId`، `strapiUserId`، `courseId` و `status: "processed"` ساخته شود.
8. نتیجه‌ی `granted` برگردد.

### هم‌زمانی و retry

unique بودن `purchaseId` در schema لازم است اما به‌تنهایی کافی نیست. در Execute باید رفتار race دو request هم‌زمان بررسی شود:

- ترجیحاً grant و create log در transaction/الگوی atomic سازگار با API همین نسخه‌ی Strapi اجرا شود.
- اگر create log با unique-constraint failure مواجه شد، رکورد برنده دوباره خوانده شود؛ اگر user/course منطبق بود، پاسخ `already_granted` داده شود و relation با merge idempotent باقی بماند؛ اگر متفاوت بود، `conflict` داده شود.
- خطای duplicate نباید به `500` یا ایجاد relation تکراری تبدیل شود.

این بخش در Execute باید با API واقعی Strapi 5 موجود در پروژه verify شود و نباید transaction API حدس زده شود.

## Validation و response contract

validation فقط برای shape و non-empty بودن payload است؛ `purchaseId` و شناسه‌ها trim می‌شوند و مقادیر خالی reject می‌شوند. lookupهای وجود user/course بخشی از business flow هستند، نه validation صرف.

تمام responseها همین کلیدها را حفظ کنند:

```js
{
  success: Boolean,
  purchaseId: String,
  status: 'granted' | 'already_granted' | 'conflict' | 'error',
  message?: String,
}
```

برای خطای payload که `purchaseId` معتبر ندارد، مقدار response باید با قرارداد توافق‌شده‌ی integration نهایی شود؛ پیشنهاد این plan استفاده از `purchaseId: String(payload?.purchaseId || '')` است تا shape ثابت بماند.

## تست‌های Jest موردنیاز

تمام تست‌ها باید query layer را mock کنند و هیچ database واقعی یا service key واقعی نیاز نداشته باشند. mockها باید queryهای زیر را قابل assert کنند:

- `api::byemoney-purchase-log.byemoney-purchase-log`
- `plugin::users-permissions.user`
- `api::course.course`

موارد تست:

1. **First-time grant**
   - log وجود ندارد، user و course وجود دارند.
   - relation با user داخلی merge می‌شود.
   - log با `processed` ساخته می‌شود.
   - پاسخ controller `200` و `{ success: true, status: 'granted' }` است.
2. **Idempotent replay**
   - همان `purchaseId` با همان `strapiUserId` و `courseId` پیدا می‌شود.
   - هیچ course update یا log create انجام نمی‌شود.
   - پاسخ `200` و `already_granted` است.
3. **Conflict by user**
   - همان `purchaseId` با user متفاوت.
   - پاسخ `409` و `conflict`؛ هیچ write انجام نمی‌شود.
4. **Conflict by course**
   - همان `purchaseId` با course متفاوت.
   - پاسخ `409` و `conflict`؛ هیچ write انجام نمی‌شود.
5. **Missing/invalid payload**
   - هرکدام از سه field حذف‌شده، `null`، غیررشته‌ای یا whitespace-only.
   - پاسخ `400` و `error`؛ query layer فراخوانی نشود.
6. **User not found**
   - log وجود ندارد و user با documentId پیدا نمی‌شود.
   - پاسخ `404` و `error`؛ course update و log create انجام نشود.
7. **Course not found**
   - log وجود ندارد، user وجود دارد و course پیدا نمی‌شود.
   - پاسخ `404` و `error`؛ course update و log create انجام نشود.
8. **Existing relation merge**
   - course از قبل userهای دیگر و حتی همان user را دارد.
   - update بدون حذف userهای موجود و بدون duplicate انجام شود.
9. **Unique-constraint race**
   - create log با duplicate key reject شود و سپس رکورد موجود منطبق خوانده شود.
   - نتیجه `already_granted` باشد؛ حالت رکورد conflict نیز جداگانه `409` تست شود.

## خارج از scope

- هیچ Ledger، wallet، payment، refund یا money logic لمس نمی‌شود.
- routeهای GET فعلی تغییر یا حذف نمی‌شوند.
- relation جدید برای access ساخته نمی‌شود.
- `enrolledChapters` برای این endpoint تغییر نمی‌کند.
- اجرای migration یا تغییرات database در Execute باید طبق workflow پروژه بعد از افزودن content-type انجام و verify شود؛ این Plan فقط فایل و مراحل لازم را مشخص می‌کند.

## معیار پذیرش Execute

- route با policy موجود و بدون Bearer auth فعال است.
- payload و تمام status codeهای contract پوشش داده شده‌اند.
- access از relation واقعی `users_permissions_users` برقرار می‌شود.
- retry همسان no-op است و purchaseId متفاوت conflict را تشخیص می‌دهد.
- نبود user/course هیچ log ناقصی ایجاد نمی‌کند.
- Jest testهای فوق سبز هستند و setup جدید با lockfile هم‌راستا است.
