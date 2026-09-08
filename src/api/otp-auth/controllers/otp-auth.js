// F:\tarhelahi\backend\src\api\otp-auth\controllers\otp-auth.js

'use strict';

const utils = require('@strapi/utils');
const { ApplicationError, NotFoundError } = utils.errors;
const smsService = require('../../../services/smsService');
const phoneUtils = require('../../../utils/phoneUtils');

module.exports = {
    
    // 1. بررسی وضعیت شماره تلفن و نوع احراز هویت
    async checkPhone(ctx) {
        const { phoneNumber } = ctx.request.body;

        if (!phoneNumber) {
            throw new ApplicationError('شماره موبایل الزامی است.');
        }

        const validation = phoneUtils.validatePhoneNumber(phoneNumber);
        if (!validation.valid) {
            throw new ApplicationError(validation.message);
        }

        const targetPhoneNumber = validation.formatted;
        const isIranian = validation.isIranian;

        // جستجوی کاربر در دیتابیس
        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: {
                $or: [
                    { phoneNumber: targetPhoneNumber },
                    { username: targetPhoneNumber },
                    ...(validation.isTest ? [{ phoneNumber: phoneUtils.extractTestPhone(targetPhoneNumber) }] : [])
                ]
            },
        });

        return ctx.send({
            isIranian,
            isTest: !!validation.isTest,
            formattedPhone: targetPhoneNumber,
            userExists: !!user,
            hasPassword: !!(user && user.password),
            is_foreigner: user ? Boolean(user.is_foreigner) : !isIranian,
        });
    },

    // 2. منطق ارسال کد یکبار مصرف (OTP)
    async send(ctx) {
        const { phoneNumber } = ctx.request.body;

        if (!phoneNumber) {
            throw new ApplicationError('شماره موبایل الزامی است.');
        }

        const validation = phoneUtils.validatePhoneNumber(phoneNumber);
        if (!validation.valid) {
            throw new ApplicationError(validation.message);
        }

        // اگر شماره خارجی باشد، پیامک ارسال نمی‌شود
        if (!validation.isIranian) {
            throw new ApplicationError('برای ورود با شماره بین‌المللی لطفاً از رمز عبور استفاده فرمایید.');
        }

        const isTestMode = !!validation.isTest;
        const targetPhoneNumber = validation.isTest 
            ? phoneUtils.extractTestPhone(validation.formatted)
            : validation.formatted;

        // تولید کد 6 رقمی (100000 تا 999999)
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); 
        const otpExpiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

        // 1. چک کردن وجود کاربر با شماره هدف
        let user = await strapi.db.query('plugin::users-permissions.user').findOne({ 
            where: { 
                $or: [
                    { phoneNumber: targetPhoneNumber },
                    { username: targetPhoneNumber }
                ]
            } 
        });

        // 2. اگر کاربر وجود نداشت، یک کاربر جدید ثبت‌نام کن (Lazy Registration)
        if (!user) {
            const defaultRole = await strapi.db.query('plugin::users-permissions.role').findOne({
                where: { type: 'authenticated' },
            });

            user = await strapi.db.query('plugin::users-permissions.user').create({
                data: {
                    phoneNumber: targetPhoneNumber,
                    username: targetPhoneNumber,
                    password: null,
                    confirmed: true,
                    is_foreigner: false,
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
                `📱 شماره کاربر هدف: ${targetPhoneNumber} (ورودی درخواست: ${phoneNumber})`,
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
                throw new ApplicationError('خطا در ارسال پیامک. لطفاً بعداً تلاش کنید.');
            }
        }

        return ctx.send({ message: 'کد تایید با موفقیت ارسال شد.', formattedPhone: targetPhoneNumber });
    },

    // 3. منطق تایید کد یکبار مصرف (OTP)
    async verify(ctx) {
        const { phoneNumber, otpCode } = ctx.request.body;

        if (!phoneNumber || !otpCode) {
            throw new ApplicationError('شماره موبایل و کد تایید الزامی است.');
        }

        const cleanOtp = phoneUtils.normalizeDigits(otpCode);
        const isTestMode = phoneUtils.isTestPhoneNumber(phoneNumber);
        const targetPhoneNumber = isTestMode
            ? phoneUtils.extractTestPhone(phoneUtils.standardizePhoneNumber(phoneNumber))
            : phoneUtils.standardizePhoneNumber(phoneNumber);

        // واکشی کاربر همراه با نقش
        let user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { 
                $or: [
                    { phoneNumber: targetPhoneNumber },
                    { username: targetPhoneNumber }
                ]
            },
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
                is_foreigner: false,
            },
        });
        
        // صدور JWT
        const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: user.id });

        const sanitizedUser = {
            id: user.id,
            username: user.username,
            phoneNumber: user.phoneNumber,
            email: user.email,
            role: user.role,
            is_foreigner: false,
        };
        
        return ctx.send({ jwt, user: sanitizedUser });
    },

    // 4. ورود کاربران با رمز عبور (مخصوص شماره‌های خارجی یا کاربران با پسورد)
    async passwordLogin(ctx) {
        const { phoneNumber, password } = ctx.request.body;

        if (!phoneNumber || !password) {
            throw new ApplicationError('شماره موبایل و رمز عبور الزامی است.');
        }

        const validation = phoneUtils.validatePhoneNumber(phoneNumber);
        const targetPhoneNumber = validation.formatted;

        let user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { 
                $or: [
                    { phoneNumber: targetPhoneNumber },
                    { username: targetPhoneNumber },
                    { email: phoneNumber.trim().toLowerCase() }
                ]
            },
            populate: ['role'],
        });

        if (!user) {
            throw new NotFoundError('کاربری با این مشخصات یافت نشد.');
        }

        if (!user.password) {
            throw new ApplicationError('برای این حساب کاربری رمز عبوری ثبت نشده است. لطفاً با پیامک وارد شوید.');
        }

        const userService = strapi.plugin('users-permissions').service('user');
        const validPassword = await userService.validatePassword(password, user.password);

        if (!validPassword) {
            throw new ApplicationError('رمز عبور وارد شده اشتباه است.');
        }

        if (user.blocked) {
            throw new ApplicationError('حساب کاربری شما مسدود شده است.');
        }

        const isForeigner = user.is_foreigner !== undefined && user.is_foreigner !== null
            ? Boolean(user.is_foreigner)
            : !validation.isIranian;

        // اگر فیلد is_foreigner تنظیم نشده بود، مقداردهی کن
        if (user.is_foreigner !== isForeigner) {
            await strapi.db.query('plugin::users-permissions.user').update({
                where: { id: user.id },
                data: { is_foreigner: isForeigner },
            });
        }

        // اگر کاربر نقش نداشت، نقش پیش‌فرض را بده
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

        const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: user.id });

        const sanitizedUser = {
            id: user.id,
            username: user.username,
            phoneNumber: user.phoneNumber,
            email: user.email,
            role: user.role,
            firstName: user.firstName,
            lastName: user.lastName,
            is_foreigner: isForeigner,
        };

        return ctx.send({ jwt, user: sanitizedUser });
    },

    // 5. ثبت‌نام کاربران با شماره بین‌المللی و رمز عبور
    async passwordRegister(ctx) {
        const { phoneNumber, password, firstName, lastName, email } = ctx.request.body;

        if (!phoneNumber || !password) {
            throw new ApplicationError('شماره موبایل و رمز عبور الزامی است.');
        }

        if (String(password).length < 6) {
            throw new ApplicationError('رمز عبور باید حداقل ۶ کاراکتر باشد.');
        }

        const validation = phoneUtils.validatePhoneNumber(phoneNumber);
        if (!validation.valid) {
            throw new ApplicationError(validation.message);
        }

        const targetPhoneNumber = validation.formatted;

        // بررسی عدم تکراری بودن شماره
        const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { 
                $or: [
                    { phoneNumber: targetPhoneNumber },
                    { username: targetPhoneNumber }
                ]
            },
        });

        if (existingUser) {
            throw new ApplicationError('کاربری با این شماره تلفن قبلاً ثبت‌نام کرده است. لطفاً وارد شوید.');
        }

        const defaultRole = await strapi.db.query('plugin::users-permissions.role').findOne({
            where: { type: 'authenticated' },
        });

        const userService = strapi.plugin('users-permissions').service('user');

        const isForeigner = !validation.isIranian;

        const newUser = await userService.add({
            phoneNumber: targetPhoneNumber,
            username: targetPhoneNumber,
            email: email && email.trim() ? email.trim().toLowerCase() : `${targetPhoneNumber.replace(/[^a-zA-Z0-9]/g, '')}@tarhelahi.com`,
            password: String(password),
            firstName: firstName || '',
            lastName: lastName || '',
            confirmed: true,
            isMobileVerified: true,
            is_foreigner: isForeigner,
            provider: 'local',
            role: defaultRole ? defaultRole.id : undefined,
        });

        const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: newUser.id });

        const sanitizedUser = {
            id: newUser.id,
            username: newUser.username,
            phoneNumber: newUser.phoneNumber,
            email: newUser.email,
            role: newUser.role || defaultRole,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            is_foreigner: isForeigner,
        };

        return ctx.send({ jwt, user: sanitizedUser });
    },
};