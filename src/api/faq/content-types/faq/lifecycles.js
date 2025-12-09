module.exports = {
    async beforeCreate(event) {
      const { data } = event.params;
      const knex = strapi.db.connection;
  
      // نام جدول واقعی در Strapi معمولاً به شکل زیر است
      // درصورت نیاز این را با نام واقعی جدول در دیتابیس خودت جایگزین کن
      const result = await knex('faqs')
        .max('no as maxNo') // توجه: 'no' حروف کوچک!
        .first();
  
      const lastNo = result && result.maxNo ? parseInt(result.maxNo) : 0;
  
      data.No = lastNo + 1;
    },
  };
  