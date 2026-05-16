// Storage upload helper (blueprint §6) — shared by Products / Banners / Settings.
//
// 2026-05-10 update — auto-resize before upload.
// The owner's phone photos were going up at 3–8 MB, blowing storage and slowing
// the storefront. Every image is now downscaled and re-encoded client-side
// before it touches Supabase. GIFs are passed through (animation matters).
// PNGs that contain transparency are kept as PNG; everything else becomes JPEG.

import { getSB } from './supabase.js';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE       = 20 * 1024 * 1024; // 20MB raw upload — we squeeze it down ourselves

const RESIZE_MAX_WIDTH   = 1600; // px, longest edge
const RESIZE_MAX_HEIGHT  = 1600;
const JPEG_QUALITY       = 0.85;
const RESIZE_TARGET_KB   = 600; // soft target — we'll lower quality in 0.05 steps if we overshoot
const MIN_QUALITY        = 0.55;

/**
 * Resize an image File to fit RESIZE_MAX_WIDTH x RESIZE_MAX_HEIGHT, returning a
 * new File. Skips the work entirely for GIFs (animations) and small images.
 *
 * Returns the original File if resizing would make it bigger.
 */
async function resizeImage(file) {
  // Pass-through cases: animated GIFs and tiny images.
  if (file.type === 'image/gif') return file;
  if (file.size < 250 * 1024)    return file; // already < 250KB — leave it

  const dataURL = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read image file'));
    r.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload  = () => resolve(i);
    i.onerror = () => reject(new Error('Could not decode image — file may be corrupt'));
    i.src = dataURL;
  });

  // Compute target dimensions while preserving aspect ratio.
  let { naturalWidth: w, naturalHeight: h } = img;
  if (w <= RESIZE_MAX_WIDTH && h <= RESIZE_MAX_HEIGHT && file.size < 1.5 * 1024 * 1024) {
    return file; // already small enough on every axis — skip the canvas trip
  }
  const scale = Math.min(RESIZE_MAX_WIDTH / w, RESIZE_MAX_HEIGHT / h, 1);
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { alpha: file.type === 'image/png' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // PNGs with transparency → keep PNG. Everything else → JPEG (smaller).
  // We detect transparency by sampling the corners; cheap and good enough.
  const keepPNG = file.type === 'image/png' && hasTransparentPixels(ctx, targetW, targetH);
  const outType = keepPNG ? 'image/png' : 'image/jpeg';

  // Iteratively reduce quality if the encoded JPEG overshoots our soft target.
  let blob = await canvasToBlob(canvas, outType, JPEG_QUALITY);
  if (!keepPNG) {
    let q = JPEG_QUALITY;
    while (blob.size > RESIZE_TARGET_KB * 1024 && q > MIN_QUALITY) {
      q = Math.max(MIN_QUALITY, q - 0.05);
      blob = await canvasToBlob(canvas, outType, q);
    }
  }

  // If our "resized" version is somehow larger than the input, keep the input.
  if (blob.size >= file.size) return file;

  const newName = file.name.replace(/\.[^.]+$/, '') + (keepPNG ? '.png' : '.jpg');
  return new File([blob], newName, { type: outType, lastModified: Date.now() });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => {
      if (!b) return reject(new Error('Image encoding failed'));
      resolve(b);
    }, type, quality);
  });
}

function hasTransparentPixels(ctx, w, h) {
  // Sample corners + center. Cheap and catches most cases.
  const points = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, h >> 1]];
  for (const [x, y] of points) {
    const px = ctx.getImageData(x, y, 1, 1).data;
    if (px[3] < 250) return true;
  }
  return false;
}

/**
 * Upload an image file to a Supabase Storage bucket using the §6 pattern:
 *   filename = `${folder}/${Date.now()}.${ext}`
 * Returns the publicUrl.
 */
export async function uploadImage(file, bucket, folder) {
  if (!file) throw new Error('No file selected');
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Image must be jpg, png, webp, or gif');
  }
  if (file.size > MAX_SIZE) {
    throw new Error(`Image is ${(file.size / 1024 / 1024).toFixed(1)}MB — max 20MB`);
  }

  // Squeeze the image client-side first.
  const compressed = await resizeImage(file).catch(err => {
    console.warn('[storage] resize failed, uploading original:', err);
    return file;
  });

  // Pick the extension from the COMPRESSED file's mime type, not the original.
  const mimeToExt = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext = mimeToExt[compressed.type] || (compressed.name.split('.').pop() || 'jpg').toLowerCase();
  const filename = `${folder}/${Date.now()}.${ext}`;
  const sb = getSB();

  const { error } = await sb.storage.from(bucket).upload(filename, compressed, {
    cacheControl: '3600',
    upsert: false,
    contentType: compressed.type,
  });
  if (error) throw error;

  const { data } = sb.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

/** Convenience wrappers per bucket (folder pattern from blueprint §6 table). */
export const uploadProductImage = (file) => uploadImage(file, 'product-images', 'products');
export const uploadBannerImage  = (file) => uploadImage(file, 'banners', 'banners');
export const uploadStoreLogo    = (file) => uploadImage(file, 'store-banners', 'store');
export const uploadQR           = (file) => uploadImage(file, 'qr-images', 'qr');
