@README.md
@../ByeMoney/AGENTS.md

# بک‌اند طرح الهی (Strapi)

- قواعد زبان، سبک پاسخ، فاز اول و ثبت تسک/باگ از `../ByeMoney/AGENTS.md` (همان فایل بالا) پیروی می‌کند.
- قرارداد API و DTO: `../ByeMoney/docs/integration/ByeMoney-Strapi-Integration.md`. فیلد یا رفتار تعریف‌نشدهٔ Strapi را حدس نزن؛ نبود قرارداد را گزارش کن.
- `JWT_SECRET` حداقل ۳۲ بایت؛ هر دو شاخهٔ `config/plugins.js` باید صریح `jwtSecret: env('JWT_SECRET')` بدهند.
- آزمون: Jest و `node --test` دو اجراکنندهٔ جدا هستند (دستورها در README). آزمون Skip‌شده یعنی قبول نشده.
- ویژگی «نور» (Light) در پروداکشن استفاده نمی‌شود؛ در بازبینی استقرار گزارشش نکن.
- `.env` و فایل‌های `.strapi/`، `.tmp/` را نخوان و تغییر نده.
