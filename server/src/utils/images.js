import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) return cb(new HttpError(400, 'Only JPEG, PNG or WebP images are allowed'));
    cb(null, true);
  },
});

/**
 * Re-encode to WebP. This validates that the bytes really are an image (the
 * client-declared mimetype is untrusted), strips EXIF/GPS metadata, and bounds
 * dimensions. Returns the stored filename.
 */
export async function saveImage(buffer, { square = false } = {}) {
  await fs.mkdir(config.uploadsDir, { recursive: true });
  let pipeline;
  try {
    pipeline = sharp(buffer, { limitInputPixels: 40_000_000 }).rotate();
    pipeline = square
      ? pipeline.resize(400, 400, { fit: 'cover' })
      : pipeline.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
    const out = await pipeline.webp({ quality: 82 }).toBuffer();
    const name = `${crypto.randomBytes(16).toString('hex')}.webp`;
    await fs.writeFile(path.join(config.uploadsDir, name), out);
    return name;
  } catch {
    throw new HttpError(400, 'Invalid or unsupported image');
  }
}

export async function deleteImage(name) {
  if (!name) return;
  try {
    await fs.unlink(path.join(config.uploadsDir, path.basename(name)));
  } catch {
    /* best effort */
  }
}

export const imageUrl = (name) => (name ? `/uploads/${name}` : null);
