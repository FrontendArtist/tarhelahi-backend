'use strict';

/**
 * message controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::message.message', ({ strapi }) => ({

    /**
     * Override find:
     * - Support front-end users listing only their own messages.
     * - Admins/instructors see all messages.
     */
    async find(ctx) {
        const user = ctx.state.user;

        // If no user is authenticated, do not return private messages
        if (!user) {
            return { data: [], meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } } };
        }

        const userWithRole = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
            populate: ['role'],
        });

        const roleType = userWithRole?.role?.type;
        const isAdmin = roleType === 'admin' || roleType === 'administrator';

        // Check if explicitly requesting personal messages (scope=my) or if normal user
        const isMyScope = ctx.query?.scope === 'my' || !isAdmin;

        if (isMyScope) {
            // Restrict to messages associated with this user
            ctx.query = {
                ...ctx.query,
                filters: {
                    ...ctx.query?.filters,
                    user: { id: { $eq: user.id } },
                },
            };
        }

        const { data, meta } = await super.find(ctx);
        return { data, meta };
    },

    /**
     * Override findOne:
     * - Verify ownership before serving details to non-admin users.
     */
    async findOne(ctx) {
        const user = ctx.state.user;
        const { data, meta } = await super.findOne(ctx);

        if (user && data) {
            const userWithRole = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
                populate: ['role'],
            });

            const roleType = userWithRole?.role?.type;
            const isAdmin = roleType === 'admin' || roleType === 'administrator';

            if (!isAdmin) {
                const ownerId = data.attributes?.user?.data?.id ?? data.user?.id;
                if (ownerId && ownerId !== user.id) {
                    return ctx.forbidden('دسترسی غیرمجاز');
                }
            }
        }

        return { data, meta };
    },

    /**
     * Override create:
     * - Link message to the logged-in user if authenticated.
     */
    async create(ctx) {
        const user = ctx.state.user;

        if (typeof ctx.request.body === 'string') {
            try {
                ctx.request.body = JSON.parse(ctx.request.body);
            } catch (e) {
                console.error('Failed to parse request body in message create controller:', e);
            }
        }

        if (!ctx.request.body) {
            ctx.request.body = {};
        }
        if (!ctx.request.body.data) {
            ctx.request.body.data = {};
        }

        if (user) {
            ctx.request.body.data.user = user.id;
        }

        ctx.request.body.data.status = ctx.request.body.data.status || 'open';
        ctx.request.body.data.messageType = ctx.request.body.data.messageType || 'instructor';
        ctx.request.body.data.replies = ctx.request.body.data.replies || [];

        const { data, meta } = await super.create(ctx);
        return { data, meta };
    },

    /**
     * Override update:
     * - Verify ownership before updating.
     * - Make sure users can update replies and status.
     */
    async update(ctx) {
        const user = ctx.state.user;
        if (!user) {
            return ctx.unauthorized('ابتدا وارد حساب کاربری شوید');
        }

        const userWithRole = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
            populate: ['role'],
        });

        const roleType = userWithRole?.role?.type;
        const isAdmin = roleType === 'admin' || roleType === 'administrator';

        if (typeof ctx.request.body === 'string') {
            try {
                ctx.request.body = JSON.parse(ctx.request.body);
            } catch (e) {
                console.error('Failed to parse request body in message update controller:', e);
            }
        }

        if (!ctx.request.body || !ctx.request.body.data) {
            return ctx.badRequest('درخواست نامعتبر است');
        }

        const { id } = ctx.params;

        const existing = await strapi.documents('api::message.message').findOne({
            documentId: id,
            populate: ['user'],
        });

        if (!existing) {
            return ctx.notFound('پیام مورد نظر یافت نشد');
        }

        if (!isAdmin) {
            const ownerId = existing.user?.id;
            if (ownerId !== user.id) {
                return ctx.forbidden('دسترسی غیرمجاز');
            }

            const allowedPayload = {};
            if (ctx.request.body.data.replies !== undefined) {
                allowedPayload.replies = ctx.request.body.data.replies;
            }
            if (ctx.request.body.data.status !== undefined) {
                allowedPayload.status = ctx.request.body.data.status;
            }
            ctx.request.body.data = allowedPayload;
        }

        const { data, meta } = await super.update(ctx);
        return { data, meta };
    },
}));
