# P6 — Storage Migration Parity

Source: `ckmnhgattkiziuykhczo` (live)
Target: `ihnnipynpdtcbdfbpemq` (`mrbeanies-prod`)
Captured: 2026-05-16 (UTC)

## What got moved — 10 files, ~2.4 MB total

| Bucket | Files | Status |
|---|---:|:---:|
| banners | 5 | ✅ |
| qr-images | 3 | ✅ |
| store-banners | 2 | ✅ |
| **Total** | **10** | **✅** |

Byte-for-byte verified on the smoke-test file (5,913 bytes). The 9 remaining files showed `409 Duplicate` in the response body after the http extension's internal retry — but the storage state confirms all 10 are present with their original sizes intact.

## Files copied (with sizes)

| Bucket | Path | Bytes |
|---|---|---:|
| banners | banners/1778401296115.jpg | 326,933 |
| banners | banners/1778401421132.jpg | 334,896 |
| banners | banners/1778401447285.jpg | 175,920 |
| banners | banners/1778401355950.jpg | 122,449 |
| banners | banners/1778401396312.jpg | 213,421 |
| qr-images | qr-1772965643116.jpg (bank QR) | 85,460 |
| qr-images | qr-1773215899525.jpg (left side panel) | 445,399 |
| qr-images | qr-1773221606093.jpg (topbar banner) | 445,399 |
| store-banners | panels/1774057481095.png (right side panel) | 291,358 |
| store-banners | store/1778377117596.png (store logo) | 5,913 |

## DB URLs rewritten

| Table | Column | Rewritten | Still pointing at old |
|---|---|---:|---:|
| banners | image_url | 5 | 0 |
| store_settings | store_logo_url, topbar_banner_url, side_left_banner_url, side_right_banner_url, bank_qr_url | 1 row × 5 cols | 0 |
| products | image_url | (blanked, per owner directive — re-upload after rebuild) | 0 |

## What was deliberately NOT migrated (per owner directive)

| Bucket | Files | Reason |
|---|---:|---|
| payment-receipts | 66 (22 MB) | Test images from pre-launch development |
| product-images | 29 (5.9 MB) | Owner will re-upload after rebuild — 78 product rows have `image_url = NULL` and will be filled in by owner via dashboard |
| cms-images | 15 (13 MB) | Beauty AI Empire Builder marketing content — never belonged on MBG project |
| payment-screenshots | 0 | Empty on live; private bucket not created on new project (storage skill says private should be created on-demand when actually used) |

## Buckets created on the new project

```
banners        public  50 MB  image/jpeg, image/png, image/webp, image/gif, video/mp4, video/webm
qr-images      public  50 MB  image/jpeg, image/png, image/webp
store-banners  public  50 MB  image/jpeg, image/png, image/webp
```

## How the transfer worked

Same trick that finished P5: `extensions.http` runs server-side on the new project.
1. `GET` from old project's public storage URL (no auth — buckets were public).
2. `POST` to new project's `/storage/v1/object/<bucket>/<path>` with the new project's anon key.
3. A temporary RLS policy on `storage.objects` allowed anon `INSERT` into the 3 buckets for the duration of P6, then was dropped.

Net effect: zero file bytes flowed through my context. Total round trips: 1 (smoke test) + 1 (batch of 9) + 1 (URL rewrite + cleanup) = 3.

## Sanity checklist (re-runnable)

```sql
-- All 10 files present?
SELECT bucket_id, count(*) FROM storage.objects
WHERE bucket_id IN ('banners','qr-images','store-banners')
GROUP BY bucket_id ORDER BY bucket_id;

-- Any DB columns still pointing at old project?
SELECT 'banners', count(*) FROM public.banners WHERE image_url LIKE '%ckmnhgattkiziuykhczo%'
UNION ALL SELECT 'store_settings', count(*) FROM public.store_settings WHERE
  store_logo_url LIKE '%ckmnhgattkiziuykhczo%' OR topbar_banner_url LIKE '%ckmnhgattkiziuykhczo%' OR
  side_left_banner_url LIKE '%ckmnhgattkiziuykhczo%' OR side_right_banner_url LIKE '%ckmnhgattkiziuykhczo%' OR
  bank_qr_url LIKE '%ckmnhgattkiziuykhczo%';
```

P6 done. The new project is now functionally complete from a data + storage perspective.
