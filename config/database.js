// path: backend/config/database.js

module.exports = ({ env }) => ({
  connection: {
    client: 'postgres',
    connection: {
      host: '127.0.0.1',
      port: 5432,
      database: 'tarhelahi_db',
      user: 'postgres',
      password: '2131380', // <-- مطمئن شوید این رمز عبور صحیح است
      ssl: false,
    },
    debug: false,
  },
});