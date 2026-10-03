# لیست تسک‌های مهاجرت و اقدامات آتی (Migration & Cleanup Tasks)

این سند تسک‌های فنی و تصمیمات مهاجرتی مرتبط با زیرساخت داده‌های قدیمی و تغییرات مالی/محصولی را ثبت و ردیابی می‌کند.

---

## 📌 تسک: تعیین تکلیف و مهاجرت سفارش‌های موروثی کارت‌به‌کارت شارژ نور (Legacy Pending Card-to-Card TopUps)

- **شناسه:** `TASK-MIGRATION-LEGACY-CARD-TO-CARD-TOPUPS`
- **تاریخ ثبت:** ۲۰۲۶-۱۰-۰۳
- **وضعیت:** در انتظار تصمیم‌گیری تجاری و اجرای اسکریپت مهاجرت (Pending Migration Decision)
- **مربوط به ارجاع:** «جمعبندی و ریسک رها کردن وضعیت فعلی (Risk if left as is)»

### ۱. شرح موضوع و زمینه (Context)
بر اساس تصمیم محصول، شارژ خودکار نور از طریق کارت‌به‌کارت توسط کاربر متوقف شده و به درگاه آنلاین (SEP) محدود شده است. همچنین از ثبت سفارش‌های جدید کارت‌به‌کارت شارژ نور توسط کاربر جلوگیری به عمل آمد (`OrderController.create`). با این حال، رکوردهای موروثی (Legacy Orders) قبلی با مشخصات زیر در دیتابیس وجود دارند:
- `paymentMethod = 'card_to_card'`
- اقلام شامل `slug: 'light-topup'` یا یادداشت‌های حاوی `[LIGHT_AMOUNT:X]`
- وضعیت‌های معلق: `orderStatus = 'pending'` و `paymentStatus IN ('pending_payment', 'pending_verification')`

### ۲. ریسک در صورت رهاسازی وضعیت فعلی (Risk if left as is)
- **عدم وجود فرآیند انقضای خودکار:** هیچ کران‌جاب، وبهوک یا لایف‌سایکلی برای منقضی یا لغو کردن این سفارش‌های موروثی در استراپی وجود ندارد.
- **انباشت سفارش‌های معلق در داشبورد ادمین:** سفارش‌های قدیمی معلق به صورت نامحدود در وضعیت `pending` باقی می‌مانند و لیست سفارشات در انتظار بررسی ادمین را شلوغ نگه می‌دارند.
- **بلاتکلیفی کاربر:** کاربرانی که در گذشته فیش ثبت نکرده‌اند یا فیش نامعتبر داشته‌اند، سفارش خود را باز و بلاتکلیف می‌بینند.

### ۳. گزینه‌ها و اقدامات مورد نیاز در گام مهاجرت (Action Items for Migration)
1. **استخراج آمار دقیق سفارش‌های باز:** اجرای کوئری فقط-خواندنی گزارش‌گیری جهت مشخص شدن تعداد دقیق و مبالغ رکوردهای باز در پروداکشن:
   ```sql
   SELECT o.order_status, o.payment_status, COUNT(DISTINCT o.id) AS total_orders
   FROM orders o
   LEFT JOIN orders_cmps oc ON oc.entity_id = o.id AND oc.field = 'items' AND oc.component_type = 'order.product-order-item'
   LEFT JOIN components_order_product_order_items poi ON poi.id = oc.cmp_id
   WHERE o.payment_method = 'card_to_card'
     AND (poi.slug = 'light-topup' OR o.notes LIKE '%[LIGHT_AMOUNT:%' OR o.notes LIKE '%[TOPUP_ID:%' OR o.notes LIKE '%شارژ نور%')
   GROUP BY o.order_status, o.payment_status;
   ```
2. **تصمیم‌گیری درباره سیاست ابطال رکوردهای قدیمی:**
   - **گزینه الف (ابطال دسته‌ای سفارش‌های قدیمی‌تر از X روز):** تغییر وضعیت به `orderStatus: 'canceled'` و `paymentStatus: 'failed'` با درج یادداشت `لغو سیستمی به دلیل انتقال سیستم شارژ نور به درگاه آنلاین`.
   - **گزینه ب (کران‌جاب انقضا):** پیاده‌سازی یک جاب دوره‌ای که سفارش‌های کارت‌به‌کارت شارژ نور که بیش از ۴۸ ساعت از ثبت آن‌ها گذشته و فیش واریز ندارند را منقضی کند.
3. **عدم حذف فیزیکی رکوردها (Audit Trail):** تأکید بر عدم حذف فیزیکی (`DELETE`) رکوردهای دیتابیس به منظور حفظ تاریخچه مالی و حسابرسی.
