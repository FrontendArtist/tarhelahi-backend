// F:\tarhelahi\backend\src\api\otp-auth\controllers\otp-auth.js

'use strict';

const utils = require('@strapi/utils');
const { ApplicationError, NotFoundError } = utils.errors;
const smsService = require('../../../services/smsService');

module.exports = {
    
    // 1. منطق ارسال کد یکبار مصرف (OTP)
    async send(ctx) {
        const { phoneNumber } = ctx.request.body;

        if (!phoneNumber) {
            throw new ApplicationError('شماره موبایل الزامی است.');
        }

        // --- شروع منطق تولید کد و ذخیره ---
        // 🚨 تغییر: تولید کد 6 رقمی (100000 تا 999999)
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); 
        const otpExpiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

        // 1. چک کردن وجود کاربر با این شماره موبایل
        let user = await strapi.db.query('plugin::users-permissions.user').findOne({ 
            where: { phoneNumber } 
        });

        // 2. اگر کاربر وجود نداشت، یک کاربر جدید ثبت‌نام کن (Lazy Registration)
        if (!user) {
            // یافتن نقش پیش‌فرض Authenticated
            const defaultRole = await strapi.db.query('plugin::users-permissions.role').findOne({
                where: { type: 'authenticated' },
            });

            user = await strapi.db.query('plugin::users-permissions.user').create({
                data: {
                    phoneNumber,
                    username: phoneNumber,
                    password: null,
                    confirmed: true,
                    otpCode,
                    otpExpiresAt,
                    provider: 'otp',
                    role: defaultRole ? defaultRole.id : undefined,
                },
            });
        } else {
            // 3. اگر کاربر وجود داشت، کد جدید را روی رکورد کاربر آپدیت کن
            await strapi.db.query('plugin::users-permissions.user').update({
                where: { id: user.id },
                data: { otpCode, otpExpiresAt },
            });
        }
        
        // ارسال کد OTP از طریق SMS.ir (Verify)
        try {
            await smsService.sendOtp(phoneNumber, otpCode);
        } catch (smsError) {
            strapi.log.error(`[SMS Service] Failed to send OTP to ${phoneNumber}: ${smsError.message}`);
        }

        return ctx.send({ message: 'کد تایید با موفقیت ارسال شد.' });
    },

    // 2. منطق تایید کد یکبار مصرف (OTP)
    async verify(ctx) {
        const { phoneNumber, otpCode } = ctx.request.body;

        if (!phoneNumber || !otpCode) {
            throw new ApplicationError('شماره موبایل و کد تایید الزامی است.');
        }

        // واکشی کاربر همراه با نقش
        let user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { phoneNumber },
            populate: ['role'], 
        });

        if (!user) {
            throw new NotFoundError('کاربری با این شماره موبایل یافت نشد.');
        }

        // چک کردن کد 
        if (user.otpCode !== otpCode) {
            throw new ApplicationError('کد تایید اشتباه است.');
        }
        
        if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
            throw new ApplicationError('کد تایید منقضی شده است. لطفا دوباره درخواست دهید.');
        }
        
        // اگر کاربر نقش نداشت، نقش Authenticated را به او تخصیص بده
        if (!user.role) {
            const defaultRole = await strapi.db.query('plugin::users-permissions.role').findOne({
                where: { type: 'authenticated' },
            });
            if (defaultRole) {
                await strapi.db.query('plugin::users-permissions.user').update({
                    where: { id: user.id },
                    data: { role: defaultRole.id },
                });
                user.role = defaultRole;
            }
        }

        // پاک کردن کد پس از تایید موفق
        await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: user.id },
            data: { 
                otpCode: null, 
                otpExpiresAt: null,
                isMobileVerified: true,
            },
        });
        
        // صدور JWT
        const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: user.id });

        // بازگرداندن فیلدها شامل role
        const sanitizedUser = {
            id: user.id,
            username: user.username,
            phoneNumber: user.phoneNumber,
            email: user.email,
            role: user.role, // اکنون نقش کاربر در پاسخ وجود دارد
        };
        
        return ctx.send({ jwt, user: sanitizedUser });
    },
};