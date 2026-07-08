require('dotenv').config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'production',
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'vpn_gpt_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vpn_gpt',
  },
};
module.exports = env;
