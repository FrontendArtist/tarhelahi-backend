'use strict';

const { errors: { ValidationError } } = require('@strapi/utils');
const invalid = message => { throw new ValidationError(message); };

function validPrice(value) {
  if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
    invalid('قیمت کاتالوگ معتبر نیست.');
  }
  return Number(value);
}

function discountedPrice(record, isForeign = false) {
  // گردکردن و قیمت بین‌المللی همان رفتار فعلی master را حفظ می‌کنند.
  if (isForeign && Number(record.internationalPrice) > 0) return validPrice(record.internationalPrice);
  const base = validPrice(record.price);
  const percent = Number(record.discountPercent ?? 0);
  const expiry = record.discountUntil ? new Date(record.discountUntil).getTime() : null;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100 || (expiry !== null && !Number.isFinite(expiry))) {
    invalid('تخفیف کاتالوگ معتبر نیست.');
  }
  return percent > 0 && (expiry === null || expiry > Date.now()) ? Math.round(base * (1 - percent / 100)) : base;
}

async function publishedItem(strapi, uid, identifier, populate = []) {
  let documentId = identifier;
  if (/^\d+$/.test(String(identifier))) {
    const id = Number(identifier);
    if (!Number.isSafeInteger(id) || id <= 0) invalid('شناسهٔ قلم معتبر نیست.');
    const record = await strapi.db.query(uid).findOne({ where: { id } });
    documentId = record?.documentId;
  }
  if (typeof documentId !== 'string' || !documentId.trim()) invalid('شناسهٔ قلم معتبر نیست.');
  const record = await strapi.documents(uid).findOne({ documentId, status: 'published', populate });
  if (!record) invalid('قلم در کاتالوگ منتشرشده یافت نشد.');
  return record;
}

async function priceCart(strapi, cartItems, context = {}) {
  if (!Array.isArray(cartItems) || cartItems.length === 0 || cartItems.length > 100) invalid('سبد خرید معتبر نیست.');
  const items = [];
  const seen = new Set();
  for (const item of cartItems) {
    if (!item || !['course', 'chapter', 'product', 'light_topup'].includes(item.type)) invalid('نوع قلم معتبر نیست.');
    const quantity = item.quantity == null ? 1 : Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || (item.type !== 'product' && quantity !== 1)) invalid('تعداد قلم معتبر نیست.');
    let priced, key;
    if (item.type === 'course') {
      if (item.chapterId != null) invalid('شناسهٔ فصل با نوع دوره سازگار نیست.');
      const course = await publishedItem(strapi, 'api::course.course', item.documentId || item.id);
      key = `course:${course.documentId}`;
      priced = { id: course.id, documentId: course.documentId, type: 'course', courseId: course.id,
        title: course.title, slug: course.slug, itemUrl: `/courses/${course.slug}`, price: discountedPrice(course, context.isForeign === true) };
    } else if (item.type === 'chapter') {
      const course = await publishedItem(strapi, 'api::course.course', item.courseId, ['chapters']);
      const chapterId = Number(item.chapterId ?? String(item.id || '').replace(/^chapter-/, ''));
      if (!Number.isSafeInteger(chapterId) || chapterId <= 0 || course.isChaptered === false) invalid('شناسهٔ فصل معتبر نیست.');
      const chapter = course.chapters?.find(chapter => chapter.id === chapterId);
      if (!chapter) invalid('فصل متعلق به دورهٔ انتخاب‌شده نیست.');
      key = `chapter:${course.documentId}:${chapter.id}`;
      priced = { id: `chapter-${chapter.id}`, documentId: course.documentId, type: 'chapter', courseId: course.id,
        chapterId: chapter.id, title: `${course.title} - ${chapter.title}`, slug: `${course.slug}-chapter-${chapter.id}`,
        itemUrl: `/courses/${course.slug}`, price: validPrice(chapter.price) };
    } else if (item.type === 'product') {
      const product = await publishedItem(strapi, 'api::product.product', item.documentId || item.id);
      key = `product:${product.documentId}`;
      priced = { id: product.id, documentId: product.documentId, type: 'product', productId: product.id,
        title: product.title, slug: product.slug, itemUrl: `/product/${product.slug}`, price: discountedPrice(product) };
    } else {
      const lightAmount = Number(item.lightAmount);
      const rate = validPrice(context.lightToTomanRate);
      if (!Number.isFinite(lightAmount) || lightAmount <= 0 || rate <= 0) invalid('مقدار شارژ معتبر نیست.');
      key = 'light_topup';
      priced = { id: 'light-topup', type: 'light_topup', productId: 0, slug: 'light-topup', itemUrl: '/profile',
        title: `شارژ ${lightAmount} نور`, price: lightAmount * rate, lightAmount };
    }
    if (seen.has(key)) invalid('قلم در سبد تکراری است.');
    seen.add(key);
    items.push({ ...priced, quantity });
  }
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) invalid('مبلغ سبد معتبر نیست.');
  return { items, total };
}

async function createCheckout(strapi, input, save) {
  return strapi.db.transaction(async () => {
    const { items, total } = await priceCart(strapi, input.cartItems, input.pricingContext);
    const code = input.couponCode == null ? null : input.couponCode;
    if (code !== null && (typeof code !== 'string' || !code.trim())) invalid('کد تخفیف معتبر نیست.');
    let finalTotal = total, discount = 0;
    if (code) {
      const couponService = strapi.service('api::coupon.coupon');
      const result = await couponService.validateAndCalculate(code, items, total);
      if (!result.valid) invalid(result.message);
      finalTotal = Number(result.finalTotalPrice);
      discount = Number(result.discountAmount);
      if (!Number.isFinite(finalTotal) || finalTotal < 0 || finalTotal > total ||
          !Number.isFinite(discount) || discount < 0 || total - discount !== finalTotal) invalid('نتیجهٔ تخفیف معتبر نیست.');
      if (finalTotal === 0) {
        const consumed = await couponService.consumeCoupon(code);
        if (!consumed.success) invalid(consumed.message);
      }
    }
    const isFree = finalTotal === 0;
    const summary = items.map((item, index) => `${index + 1}. ${item.title}${item.type === 'light_topup' ? ` [LIGHT_AMOUNT:${item.lightAmount}]` : ''}`).join('\n');
    // نشانگر مالی فقط از دادهٔ محاسبه‌شده ساخته می‌شود؛ یادداشت کاربر آن را جعل نمی‌کند.
    const notes = typeof input.notes === 'string' ? input.notes.replace(/\[(?:LIGHT_AMOUNT|TOPUP_ID):[^\]]*\]/g, '').trim() : '';
    return save({
      user: input.user, fullName: input.fullName, address: input.address, postalCode: input.postalCode,
      phone: input.phone, email: input.email, notes: `📋 اقلام این سفارش:\n${summary}${notes ? `\n\n${notes}` : ''}`,
      totalPrice: finalTotal, originalTotalPrice: total, couponCode: code?.trim() || null, discountAmount: discount,
      paymentMethod: isFree ? 'free' : input.paymentMethod === 'card_to_card' ? 'card_to_card' : 'online',
      orderStatus: isFree ? 'paid' : 'pending', paymentStatus: isFree ? 'paid' : 'pending_payment',
      items: items.map(item => ({
        __component: item.type === 'course' || item.type === 'chapter' ? 'order.course-order-item' : 'order.product-order-item',
        title: item.title, slug: item.slug, price: item.price, itemUrl: item.itemUrl,
        ...(item.type === 'course' || item.type === 'chapter' ? { courseId: item.courseId,
          ...(item.type === 'chapter' ? { chapterId: item.chapterId } : {}) } : { productId: item.productId, quantity: item.quantity }),
      })),
    });
  });
}

module.exports = { priceCart, createCheckout };
