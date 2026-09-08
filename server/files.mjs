import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from './config.mjs';
import { apiError, clean, token } from './utils.mjs';

const ROOTS = new Set(['uploads', 'line-inbox', 'receipt-cards', 'templates', 'exports', 'tmp']);

export async function ensureDataDirs() {
  await Promise.all([...ROOTS].map(name => fs.mkdir(path.join(config.dataDir, name), { recursive: true, mode: 0o750 })));
}

export function parseDataUrl(value, allowed = []) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || ''));
  if (!match) throw apiError('INVALID_FILE', 'รูปแบบไฟล์ไม่ถูกต้อง');
  const mime = match[1].toLowerCase();
  if (allowed.length && !allowed.includes(mime)) throw apiError('INVALID_FILE_TYPE', 'ชนิดไฟล์ไม่ได้รับอนุญาต');
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > config.maxBodyBytes) throw apiError('FILE_TOO_LARGE', 'ไฟล์มีขนาดใหญ่เกินกำหนด');
  return { mime, buffer };
}

export function safeName(value, fallback = 'file') {
  const base = path.basename(clean(value, 255)).normalize('NFKC').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-').replace(/^\.+/, '').slice(0, 180);
  return base || fallback;
}

function relativePath(root, fileName) {
  if (!ROOTS.has(root)) throw apiError('INVALID_STORAGE_ROOT', 'ตำแหน่งจัดเก็บไม่ถูกต้อง');
  const month = new Date().toISOString().slice(0, 7);
  return path.posix.join(root, month, `${token(9)}-${safeName(fileName)}`);
}

export function absolutePath(relative) {
  const normalized = path.posix.normalize(clean(relative, 700)).replace(/^\/+/, '');
  const root = normalized.split('/')[0];
  if (!ROOTS.has(root) || normalized.includes('../')) throw apiError('INVALID_FILE_PATH', 'ตำแหน่งไฟล์ไม่ถูกต้อง');
  const absolute = path.resolve(config.dataDir, normalized);
  if (!absolute.startsWith(config.dataDir + path.sep)) throw apiError('INVALID_FILE_PATH', 'ตำแหน่งไฟล์ไม่ถูกต้อง');
  return absolute;
}

export async function storeBuffer(root, fileName, buffer) {
  const relative = relativePath(root, fileName);
  const absolute = absolutePath(relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o750 });
  await fs.writeFile(absolute, buffer, { mode: 0o640 });
  return { relative, size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

export async function storeCompressedImage(root, fileName, dataUrl, options = {}) {
  const parsed = parseDataUrl(dataUrl, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  const maxLongEdge = options.maxLongEdge || 1800;
  let pipeline = sharp(parsed.buffer, { failOn: 'warning', limitInputPixels: 45_000_000 }).rotate().resize({ width: maxLongEdge, height: maxLongEdge, fit: 'inside', withoutEnlargement: true });
  const buffer = await pipeline.jpeg({ quality: options.quality || 80, mozjpeg: true }).toBuffer();
  const meta = await sharp(buffer).metadata();
  const stored = await storeBuffer(root, safeName(fileName).replace(/\.[^.]+$/, '') + '.jpg', buffer);
  return { ...stored, mime: 'image/jpeg', width: meta.width || 0, height: meta.height || 0, originalSize: parsed.buffer.length, compression: `jpeg-q${options.quality || 80}` };
}

export async function readBuffer(relative) {
  return fs.readFile(absolutePath(relative));
}

export async function removeFile(relative) {
  try { await fs.unlink(absolutePath(relative)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
