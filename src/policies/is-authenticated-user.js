'use strict';

// فقط کاربر دارای JWT معتبر؛ بدون بررسی نقش یا مجوز مالی.
// با auth.scope خالی، استرپی درخواست بدون توکن را هم عبور می‌دهد، پس نبود کاربر اینجا رد می‌شود.
module.exports = (ctx) => Boolean(ctx.state?.user?.id);
