// path: ./config/server.js
module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'https://tarhelahi-nodejs.liara.run'),
  proxy: true, // این باید حتما true باشد
  app: {
    keys: env.array('APP_KEYS'),
  },
});