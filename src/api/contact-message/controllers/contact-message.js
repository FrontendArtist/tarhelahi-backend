'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::contact-message.contact-message', ({ strapi }) => ({

    /**
     * Override find:
     * - Support front-end users listing only their own messages.
     * - Admins see all messages.
     */
    async find(ctx) {
        const user = ctx.state.user;

        // If not logged in, do not return private contact messages to public
        if (!user) {
            return { data: [], meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } } };
        }

        // Detect if the user is an admin by querying user role
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

        // If not logged in, let standard findOne handle (returns public permissions check)
        const { data, meta } = await super.findOne(ctx);

        if (user && data) {
            const userWithRole = await strapi.entityService.findOne('plugin::users-permissions.user', user.id, {
                populate: ['role'],
            });

            const roleType = userWithRole?.role?.type;
            const isAdmin = roleType === 'admin' || roleType === 'administrator';

            if (!isAdmin) {
                // Check if user owns this message
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

        // Safely parse body if it arrives as a string
        if (typeof ctx.request.body === 'string') {
            try {
                ctx.request.body = JSON.parse(ctx.request.body);
            } catch (e) {
                console.error('Failed to parse request body in contact-message create controller:', e);
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

        ctx.request.body.data.status = 'open';
        ctx.request.body.data.replies = ctx.request.body.data.replies || [];

        const { data, meta } = await super.create(ctx);
        return { data, meta };
    },

    /**
     * Override update:
     * - Verify ownership before updating.
     * - Make sure users can only update replies and status, not sender info or other fields.
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

        // Safely parse body if it arrives as a string
        if (typeof ctx.request.body === 'string') {
            try {
                ctx.request.body = JSON.parse(ctx.request.body);
            } catch (e) {
                console.error('Failed to parse request body in contact-message update controller:', e);
            }
        }

        if (!ctx.request.body || !ctx.request.body.data) {
            return ctx.badRequest('درخواست نامعتبر است');
        }

        // Check if message exists and who owns it
        const { id } = ctx.params;

        // Strapi v5: load document using Document Service by documentId (string)
        const existing = await strapi.documents('api::contact-message.contact-message').findOne({
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

            // A normal user can only update 'replies' and 'status' (e.g. they can re-open a message if closed)
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
