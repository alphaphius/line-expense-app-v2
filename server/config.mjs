import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';

const int = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
};

export const config = Object.freeze({
  appName: 'WorkHub',
  appVersion: '4.9.19-nas',
  apiVersion: '2.0',
  schemaVersion: 14,
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
  receiptGeminiApiKey: process.env.RECEIPT_GEMINI_API_KEY || '',
  receiptGeminiModel: process.env.RECEIPT_GEMINI_MODEL || 'gemini-3.6-flash',
  receiptGeminiFallbackModel: process.env.RECEIPT_GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite',
  receiptAiMaxAttempts: Math.max(2, Math.min(10, int('RECEIPT_AI_MAX_ATTEMPTS', 5))),
  receiptAiImagesPerRequest: Math.max(1, Math.min(8, int('RECEIPT_AI_IMAGES_PER_REQUEST', 6))),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  geminiFallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite',
  billAiMaxAttempts: Math.max(2, Math.min(10, int('BILL_AI_MAX_ATTEMPTS', 5))),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  lineChannelSecret: process.env.LINE_CHANNEL_SECRET || '',
  lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  lineSessionHours: int('LINE_SESSION_HOURS', 6),
  lineMaxImageBytes: int('LINE_MAX_IMAGE_BYTES', 15 * 1024 * 1024),
  databaseAdminUrl: process.env.DATABASE_ADMIN_URL || '',
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  googleMapsMapId: process.env.GOOGLE_MAPS_MAP_ID || '',
  trustProxy: process.env.TRUST_PROXY !== 'false',
});
