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

        // تبدیل اعداد فارسی/عربی و تشخیص شماره تست
        let cleanPhone = String(phoneNumber)
            .trim()
            .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
            .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

        const isTestMode = /^[Tt]/.test(cleanPhone);
        // اگر شماره با T یا t شروع شده بود، به شماره اصلی با 0 تبدیل می‌شود (مثال: T9019028765 -> 09019028765)
        const targetPhoneNumber = isTestMode ? cleanPhone.replace(/^[Tt]0?/, '0') : cleanPhone;

        // --- شروع منطق تولید کد و ذخیره ---
        // تولید کد 6 رقمی (100000 تا 999999)
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); 
        const otpExpiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

        // 1. چک کردن وجود کاربر با شماره هدف
        let user = await strapi.db.query('plugin::users-permissions.user').findOne({ 
            where: { phoneNumber: targetPhoneNumber } 
        });

        // 2. اگر کاربر وجود نداشت، یک کاربر جدید ثبت‌نام کن (Lazy Registration)
        if (!user) {
            // یافتن نقش پیش‌فرض Authenticated
            const defaultRole = await strapi.db.query('plugin::users-permissions.role').findOne({
                where: { type: 'authenticated' },
            });

            user = await strapi.db.query('plugin::users-permissions.user').create({
                data: {
                    phoneNumber: targetPhoneNumber,
                    username: targetPhoneNumber,
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
        
        // ارسال پیامک یا حالت تست بدون ارسال
        if (isTestMode) {
            const banner = [
                '====================================================================',
                `🧪 [حالت تست / دیباگ لاگین - پیامک ارسال نمی‌شود]`,
                `📱 شماره کاربر هدف: ${targetPhoneNumber} (ورودی درخواست: ${cleanPhone})`,
                `🔑 کد یکبار مصرف (OTP): ${otpCode}`,
                `⏱️ انقضا تا: ${otpExpiresAt.toLocaleTimeString('fa-IR')}`,
                '===================================================================='
            ].join('\n');

            strapi.log.warn(banner);
            console.log('\n' + banner + '\n');
        } else {
            // ارسال کد OTP از طریق SMS.ir (Verify)
            try {
                await smsService.sendOtp(targetPhoneNumber, otpCode);
            } catch (smsError) {
                strapi.log.error(`[SMS Service] Failed to send OTP to ${targetPhoneNumber}: ${smsError.message}`);
            }
        }

        return ctx.send({ message: 'کد تایید با موفقیت ارسال شد.' });
    },

    // 2. منطق تایید کد یکبار مصرف (OTP)
    async verify(ctx) {
        const { phoneNumber, otpCode } = ctx.request.body;

        if (!phoneNumber || !otpCode) {
            throw new ApplicationError('شماره موبایل و کد تایید الزامی است.');
        }

        // تبدیل اعداد فارسی/عربی و حذف فاصله‌ها
        let cleanPhone = String(phoneNumber)
            .trim()
            .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
            .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

        let cleanOtp = String(otpCode)
            .trim()
            .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
            .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

        // اگر شماره با T یا t ارسال شده بود، به شماره اصلی با 0 تبدیل می‌شود
        const targetPhoneNumber = /^[Tt]/.test(cleanPhone) 
            ? cleanPhone.replace(/^[Tt]0?/, '0') 
            : cleanPhone;

        // واکشی کاربر همراه با نقش
        let user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { phoneNumber: targetPhoneNumber },
            populate: ['role'], 
        });

        if (!user) {
            throw new NotFoundError('کاربری با این شماره موبایل یافت نشد.');
        }

        // چک کردن کد 
        if (user.otpCode !== cleanOtp) {
            throw new ApplicationError('کد تایید اشتباه است.');
        }
        
        if (!user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) {
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