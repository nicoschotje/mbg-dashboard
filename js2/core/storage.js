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
 * Reads the EXIF orientation tag (1–8) from a JPEG. Returns 1 when the tag is
 * absent or the file is not a JPEG.
 */
async function getExifOrientation(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const view = new DataView(e.target.result);
      if (view.getUint16(0, false) !== 0xFFD8) return resolve(1);
      const length = view.byteLength;
      let offset = 2;
      while (offset < length) {
        if (offset + 4 > length) break;
        const marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xFFE1) {
          if (view.getUint32(offset += 2, false) !== 0x45786966) return resolve(1);
          const little = view.getUint16(offset += 6, false) === 0x4949;
          offset += view.getUint32(offset + 4, little);
          const tags = view.getUint16(offset, little);
          offset += 2;
          for (let i = 0; i < tags; i++) {
            if (view.getUint16(offset + i * 12, little) === 0x0112) {
              return resolve(view.getUint16(offset + i * 12 + 8, little));
            }
          }
        } else if ((marker & 0xFF00) !== 0xFF00) break;
        else offset += view.getUint16(offset, false);
      }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

/**
 * Reads the true encoded pixel size from a JPEG's SOF marker — i.e. the size
 * BEFORE any EXIF orientation would be applied. Used to tell whether the
 * browser has already auto-oriented the decoded <img>. Returns null when the
 * file is not a parseable JPEG.
 */
async function getJpegEncodedSize(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const view = new DataView(e.target.result);
        if (view.getUint16(0, false) !== 0xFFD8) return resolve(null);
        const length = view.byteLength;
        let offset = 2;
        while (offset + 4 <= length) {
          const marker = view.getUint16(offset, false);
          if ((marker & 0xFF00) !== 0xFF00) return resolve(null);
          // SOF0–SOF15 carry the frame size; skip DHT/JPG/DAC which do not.
          if (marker >= 0xFFC0 && marker <= 0xFFCF &&
              marker !== 0xFFC4 && marker !== 0xFFC8 && marker !== 0xFFCC) {
            return resolve({
              h: view.getUint16(offset + 5, false),
              w: view.getUint16(offset + 7, false),
            });
          }
          offset += 2 + view.getUint16(offset + 2, false);
        }
        resolve(null);
      } catch (_) { resolve(null); }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file);
  });
}

// Cached answer to "does this browser auto-apply EXIF orientation when it
// decodes an <img>?" — learned the first time we process a rotated photo.
let _browserAutoOrients = null;

/**
 * Orientation-aware, scaled canvas draw. `dw`/`dh` are the target draw size
 * in the image's OWN (pre-rotation) axes; the transform applies the EXIF
 * rotation/flip and drawImage applies the downscale.
 */
function drawWithOrientation(ctx, img, orientation, dw, dh) {
  ctx.save();
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, dw, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, dw, dh); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, dh); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, dh, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, dh, dw); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, dw); break;
    default: break;
  }
  ctx.drawImage(img, 0, 0, dw, dh);
  ctx.restore();
}

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

  // EXIF orientation tag (1–8). iPhone camera photos commonly carry 3/6/8.
  const orientation = await getExifOrientation(file);

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

  // Decide whether WE must apply the EXIF rotation, or the browser already
  // baked it into the decoded <img>. Modern iOS Safari / Chrome auto-orient,
  // so rotating again would double-rotate; older engines do not. We tell the
  // two apart by comparing the decoded dimensions against the JPEG's true
  // encoded size, read straight from the SOF marker.
  let drawOrientation = 1;
  if (orientation > 1) {
    const enc = await getJpegEncodedSize(file);
    const swapped = orientation >= 5 && orientation <= 8;
    let browserOriented;
    if (enc && swapped && w !== h) {
      if      (w === enc.h && h === enc.w) browserOriented = true;
      else if (w === enc.w && h === enc.h) browserOriented = false;
      else browserOriented = _browserAutoOrients !== false;
      _browserAutoOrients = browserOriented; // cache for later non-swapped files
    } else {
      // Non-swapped orientation, square image, or unreadable SOF: the decoded
      // dimensions can't reveal it. Use the cached capability; default to
      // "browser handles it" so we never double-rotate (pre-fix behaviour).
      browserOriented = _browserAutoOrients !== false;
    }
    if (!browserOriented) drawOrientation = orientation;
  }

  // For a 90° rotation the visible canvas axes are transposed.
  const swapCanvas = drawOrientation >= 5 && drawOrientation <= 8;
  const canvas = document.createElement('canvas');
  canvas.width  = swapCanvas ? targetH : targetW;
  canvas.height = swapCanvas ? targetW : targetH;
  const ctx = canvas.getContext('2d', { alpha: file.type === 'image/png' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawWithOrientation(ctx, img, drawOrientation, targetW, targetH);

  // PNGs with transparency → keep PNG. Everything else → JPEG (smaller).
  // We detect transparency by sampling the corners; cheap and good enough.
  const keepPNG = file.type === 'image/png' && hasTransparentPixels(ctx, canvas.width, canvas.height);
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
