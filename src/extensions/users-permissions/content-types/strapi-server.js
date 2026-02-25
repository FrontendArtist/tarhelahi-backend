module.exports = (plugin) => {
  // اطمینان از اینکه JWT strategy به درستی کار می‌کند
  plugin.services.jwt.getToken = (ctx) => {
    const params = ctx.request.query;
    let token = params.access_token;

    if (!token && ctx.request && ctx.request.header && ctx.request.header.authorization) {
      const parts = ctx.request.header.authorization.split(/\s+/);
      
      if (parts[0].toLowerCase() !== 'bearer' || parts.length !== 2) {
        return null;
      }
      
      token = parts[1];
    }

    return token;
  };

  return plugin;
};