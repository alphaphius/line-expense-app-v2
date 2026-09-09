import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';

const int = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
};

export const config = Object.freeze({
  appName: 'WorkHub',
  appVersion: '4.3.0-nas',
  apiVersion: '2.0',
  schemaVersion: 3,
  host: process.env.HOST || '0.0.0.0',
  port: int('PORT', 8080),
  dataDir: path.resolve(process.env.DATA_DIR || './.workhub-data'),
  publicDir: path.resolve(process.env.PUBLIC_DIR || './dist'),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    user: process.env.DB_USER || 'workhub',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'workhub',
    connectionLimit: int('DB_CONNECTION_LIMIT', 10),
  },
  passwordHash: process.env.WORKHUB_PASSWORD_HASH || '',
  sessionSeconds: int('API_SESSION_SECONDS', 6 * 60 * 60),
  protectedSessionSeconds: int('PROTECTED_SESSION_SECONDS', 30 * 24 * 60 * 60),
  maxAttempts: int('PROTECTED_MAX_ATTEMPTS', 5),
  globalMaxAttempts: int('PROTECTED_GLOBAL_MAX_ATTEMPTS', 30),
  lockoutSeconds: int('PROTECTED_LOCKOUT_SECONDS', 15 * 60),
  attemptWindowSeconds: int('PROTECTED_ATTEMPT_WINDOW_SECONDS', 15 * 60),
  maxBodyBytes: int('MAX_BODY_BYTES', 18 * 1024 * 1024),
  maxPagesPerBill: int('MAX_PAGES_PER_BILL', 6),
  receiptMaxBatchCards: int('RECEIPT_MAX_BATCH_CARDS', 40),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET || '',
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  lineSessionHours: int('LINE_SESSION_HOURS', 6),
  lineMaxImageBytes: int('LINE_MAX_IMAGE_BYTES', 15 * 1024 * 1024),
  databaseAdminUrl: process.env.DATABASE_ADMIN_URL || '',
  trustProxy: process.env.TRUST_PROXY !== 'false',
});
