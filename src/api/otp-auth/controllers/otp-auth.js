// F:\tarhelahi\backend\src\api\otp-auth\controllers\otp-auth.js

'use strict';

const crypto = require('crypto');
const utils = require('@strapi/utils');
const { ApplicationError, NotFoundError } = utils.errors;
const smsService = require('../../../services/smsService');
const phoneUtils = require('../../../utils/phoneUtils');

const OTP_TTL_MS = 2 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = Number(process.env.OTP_RESEND_COOLDOWN_MS) || 60 * 1000;

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function getOtpSecret() {
  return process.env.OTP_SECRET || process.env.JWT_SECRET || 'dev-otp-hmac-secret';
}

function hashOtpCode(phoneNumber, code) {
  return (
    'hmac:' +
    crypto
      .createHmac('sha256', getOtpSecret())
      .update(`${String(phoneNumber)}:${String(code)}`)
      .digest('hex')
  );
}

function verifyOtpHash(phoneNumber, candidateCode, storedHash) {
  if (!candidateCode || !storedHash || typeof storedHash !== 'string') {
    return false;
  }
  const expected = Buffer.from(hashOtpCode(phoneNumber, String(candidateCode)), 'utf8');
  const actual = Buffer.from(storedHash, 'utf8');
  if (expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

async function incrementFailedOtpAttempts(user) {
  let nextAttempts = (Number(user.otpAttempts) || 0) + 1;

  if (strapi?.db?.connection) {
    const userMeta = strapi.db.metadata?.get?.('plugin::users-permissions.user');
    const tableName = userMeta?.tableName || 'up_users';
    await strapi.db.connection(tableName).where({ id: user.id }).increment('otp_attempts', 1);
    const updatedRow = await strapi.db.connection(tableName).where({ id: user.id }).select('otp_attempts').first();
    if (updatedRow && updatedRow.otp_attempts !== undefined) {
      nextAttempts = Number(updatedRow.otp_attempts) || nextAttempts;
    }
  } else {
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { otpAttempts: nextAttempts },
    });
  }

  if (nextAttempts >= OTP_MAX_ATTEMPTS) {
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: nextAttempts,
      },
    });
  }

  return nextAttempts;
}

async function verifyUserOtpOrThrow(user, targetPhoneNumber, rawOtpCode) {
  const cleanOtp = phoneUtils.normalizeDigits(rawOtpCode);

  if (!user.otpCode || !user.otpExpiresAt || new Date(user.otpExpiresAt) < new Date()) {
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiresAt: null, otpAttempts: 0 },
    });
    throw new ApplicationError('کد تایید منقضی شده است. لطفا دوباره درخواست دهید.');
  }

  if ((Number(user.otpAttempts) || 0) >= OTP_MAX_ATTEMPTS) {
    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiresAt: null },
    });
    throw new ApplicationError('تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کد تایید جدید درخواست دهید.');
  }

  if (!verifyOtpHash(targetPhoneNumber, cleanOtp, user.otpCode)) {
    const attempts = await incrementFailedOtpAttempts(user);
    if (attempts >= OTP_MAX_ATTEMPTS) {
      throw new ApplicationError('تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کد تایید جدید درخواست دهید.');
    }
    throw new ApplicationError('کد تایید اشتباه است.');
  }
}

function buildSanitizedUser(user, fallbackRole, isForeigner) {
  return {
    id: user.id,
    documentId: user.documentId,
    username: user.username,
    phoneNumber: user.phoneNumber,
    email: user.email,
    role: user.role || fallbackRole,
    firstName: user.firstName,
    lastName: user.lastName,
    is_foreigner: isForeigner,
  };
}

module.exports = {
  // 1. بررسی وضعیت شماره تلفن و نوع احراز هویت
  async checkPhone(ctx) {
    const { phoneNumber } = ctx.request.body || {};

    if (!phoneNumber) {
      throw new ApplicationError('شماره موبایل الزامی است.');
    }

    const validation = phoneUtils.validatePhoneNumber(phoneNumber);
    if (!validation.valid) {
      throw new ApplicationError(validation.message);
    }

    const targetPhoneNumber = validation.formatted;
    const isIranian = validation.isIranian;

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        $or: [
          { phoneNumber: targetPhoneNumber },
          { username: targetPhoneNumber },
          ...(validation.isTest ? [{ phoneNumber: phoneUtils.extractTestPhone(targetPhoneNumber) }] : []),
        ],
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
    const { phoneNumber } = ctx.request.body || {};

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
    const targetPhoneNumber = isTestMode
      ? phoneUtils.extractTestPhone(validation.formatted)
      : validation.formatted;

    let user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        $or: [
          { phoneNumber: targetPhoneNumber },
          { username: targetPhoneNumber },
        ],
      },
    });

    if (user?.blocked) {
      return ctx.forbidden('حساب کاربری شما مسدود شده است.');
    }

    if (user?.otpLastSentAt) {
      const elapsed = Date.now() - new Date(user.otpLastSentAt).getTime();
      if (elapsed >= 0 && elapsed < OTP_RESEND_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
        ctx.status = 429;
        return ctx.send({
          error: {
            status: 429,
            name: 'TooManyRequestsError',
            message: `لطفاً ${waitSeconds} ثانیه دیگر برای ارسال مجدد کد صبر کنید.`,
          },
        });
      }
    }

    const otpCode = generateOtpCode();
    const hashedOtp = hashOtpCode(targetPhoneNumber, otpCode);
    const now = new Date();
    const otpExpiresAt = new Date(now.getTime() + OTP_TTL_MS);

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
          otpCode: hashedOtp,
          otpExpiresAt,
          otpAttempts: 0,
          otpLastSentAt: now,
          provider: 'otp',
          role: defaultRole ? defaultRole.id : undefined,
        },
      });
    } else {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: {
          otpCode: hashedOtp,
          otpExpiresAt,
          otpAttempts: 0,
          otpLastSentAt: now,
        },
      });
    }

    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      const banner = [
        '====================================================================',
        isTestMode
          ? `[TEST / DEBUG MODE - NO SMS SENT]`
          : `[SMS.ir OTP SENDING]`,
        `Target Phone: ${targetPhoneNumber} (Input: ${phoneNumber})`,
        `OTP Code: ${otpCode}`,
        `Expires At: ${otpExpiresAt.toISOString()}`,
        '====================================================================',
      ].join('\n');
      strapi.log.info(banner);
      console.log('\n' + banner + '\n');
    }

    if (isTestMode) {
      if (isDev) strapi.log.warn(`[OTP] Test mode active - SMS not sent. OTP Code: ${otpCode}`);
    } else {
      try {
        await smsService.sendOtp(targetPhoneNumber, otpCode);
        if (isDev) strapi.log.info(`[SMS Service] [OK] OTP sent successfully to ${targetPhoneNumber}`);
      } catch (smsError) {
        await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: user.id },
          data: { otpLastSentAt: null },
        }).catch(() => {});

        if (isDev) {
          const detail = smsError.response
            ? JSON.stringify(smsError.response.data || smsError.response.statusText)
            : smsError.message;
          strapi.log.error(`[SMS Service] [ERROR] Failed to send OTP to ${targetPhoneNumber}: ${detail}`);
        }
        throw new ApplicationError('خطا در ارسال پیامک. لطفاً بعداً تلاش کنید.');
      }
    }

    return ctx.send({ message: 'کد تایید با موفقیت ارسال شد.', formattedPhone: targetPhoneNumber });
  },

  // 3. منطق تایید کد یکبار مصرف (OTP)
  async verify(ctx) {
    const { phoneNumber, otpCode } = ctx.request.body || {};

    if (!phoneNumber || !otpCode) {
      throw new ApplicationError('شماره موبایل و کد تایید الزامی است.');
    }

    const isTestMode = phoneUtils.isTestPhoneNumber(phoneNumber);
    const targetPhoneNumber = isTestMode
      ? phoneUtils.extractTestPhone(phoneUtils.standardizePhoneNumber(phoneNumber))
      : phoneUtils.standardizePhoneNumber(phoneNumber);

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        $or: [
          { phoneNumber: targetPhoneNumber },
          { username: targetPhoneNumber },
        ],
      },
      populate: ['role'],
    });

    if (!user) {
      throw new NotFoundError('کاربری با این شماره موبایل یافت نشد.');
    }

    if (user.blocked) {
      return ctx.forbidden('حساب کاربری شما مسدود شده است.');
    }

    await verifyUserOtpOrThrow(user, targetPhoneNumber, otpCode);

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

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        isMobileVerified: true,
        is_foreigner: false,
      },
    });

    const jwt = strapi.plugins['users-permissions'].services.jwt.issue({
      id: user.id,
      documentId: user.documentId,
    });

    return ctx.send({ jwt, user: buildSanitizedUser(user, user.role, false) });
  },

  // 4. ورود کاربران با رمز عبور (مخصوص شماره‌های خارجی یا کاربران با پسورد)
  async passwordLogin(ctx) {
    const { phoneNumber, password } = ctx.request.body || {};

    if (!phoneNumber || !password) {
      throw new ApplicationError('شماره موبایل و رمز عبور الزامی است.');
    }

    const validation = phoneUtils.validatePhoneNumber(phoneNumber);
    const targetPhoneNumber = validation.formatted;

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        $or: [
          { phoneNumber: targetPhoneNumber },
          { username: targetPhoneNumber },
          { email: String(phoneNumber).trim().toLowerCase() },
        ],
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
      return ctx.forbidden('حساب کاربری شما مسدود شده است.');
    }

    const isForeigner =
      user.is_foreigner !== undefined && user.is_foreigner !== null
        ? Boolean(user.is_foreigner)
        : !validation.isIranian;

    if (user.is_foreigner !== isForeigner) {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { is_foreigner: isForeigner },
      });
    }

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

    const jwt = strapi.plugins['users-permissions'].services.jwt.issue({
      id: user.id,
      documentId: user.documentId,
    });

    return ctx.send({ jwt, user: buildSanitizedUser(user, user.role, isForeigner) });
  },

  // 5. ثبت‌نام با رمز عبور (شماره ایرانی فقط با OTP معتبر؛ شماره خارجی با وضعیت تاییدنشده)
  async passwordRegister(ctx) {
    const { phoneNumber, password, firstName, lastName, email, otpCode } = ctx.request.body || {};

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
    const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        $or: [
          { phoneNumber: targetPhoneNumber },
          { username: targetPhoneNumber },
        ],
      },
      populate: ['role'],
    });

    const userService = strapi.plugin('users-permissions').service('user');
    const defaultRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'authenticated' },
    });

    if (validation.isIranian) {
      if (!otpCode) {
        throw new ApplicationError('ثبت‌نام با رمز عبور برای شماره‌های ایرانی فقط پس از تأیید کد یکبار مصرف (OTP) مجاز است.');
      }

      if (!existingUser) {
        throw new ApplicationError('ابتدا کد تایید (OTP) برای این شماره درخواست کنید.');
      }

      if (existingUser.blocked) {
        return ctx.forbidden('حساب کاربری شما مسدود شده است.');
      }

      if (existingUser.password) {
        throw new ApplicationError('کاربری با این شماره تلفن قبلاً ثبت‌نام کرده است. لطفاً وارد شوید.');
      }

      await verifyUserOtpOrThrow(existingUser, targetPhoneNumber, otpCode);

      const updateData = {
        password: String(password),
        confirmed: true,
        isMobileVerified: true,
        is_foreigner: false,
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      };
      if (firstName) updateData.firstName = firstName;
      if (lastName) updateData.lastName = lastName;
      if (email && email.trim()) {
        updateData.email = email.trim().toLowerCase();
      } else if (!existingUser.email) {
        updateData.email = `${targetPhoneNumber.replace(/[^a-zA-Z0-9]/g, '')}@tarhelahi.com`;
      }
      if (!existingUser.role && defaultRole) {
        updateData.role = defaultRole.id;
      }

      const updatedUser = await userService.edit(existingUser.id, updateData);
      const userObj = updatedUser || existingUser;

      const jwt = strapi.plugins['users-permissions'].services.jwt.issue({
        id: userObj.id,
        documentId: userObj.documentId || existingUser.documentId,
      });

      return ctx.send({
        jwt,
        user: buildSanitizedUser(userObj, existingUser.role || defaultRole, false),
      });
    }

    if (existingUser) {
      throw new ApplicationError('کاربری با این شماره تلفن قبلاً ثبت‌نام کرده است. لطفاً وارد شوید.');
    }

    const newUser = await userService.add({
      phoneNumber: targetPhoneNumber,
      username: targetPhoneNumber,
      email:
        email && email.trim()
          ? email.trim().toLowerCase()
          : `${targetPhoneNumber.replace(/[^a-zA-Z0-9]/g, '')}@tarhelahi.com`,
      password: String(password),
      firstName: firstName || '',
      lastName: lastName || '',
      confirmed: true,
      isMobileVerified: false,
      is_foreigner: true,
      provider: 'local',
      role: defaultRole ? defaultRole.id : undefined,
    });

    const jwt = strapi.plugins['users-permissions'].services.jwt.issue({
      id: newUser.id,
      documentId: newUser.documentId,
    });

    return ctx.send({
      jwt,
      user: buildSanitizedUser(newUser, defaultRole, true),
    });
  },
};
