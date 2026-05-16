# P3 — Pre-flight survey of recovered storefront

Captured: 2026-05-15 (UTC) after grepping `storefront/` for P3 targets.

## What P3 actually has to touch

### 1. Strip COD — narrower than expected (3 lines total)

| File | Line | Match |
|---|---:|---|
| `storefront/js/modules/checkout.js` | 161 | `if (method === 'cod') {` |
| `storefront/js/modules/checkout.js` | 163 | `<h4>Cash on Delivery</h4>` |
| `storefront/js/core/config.js` | 29 | `{ id: 'cod', label: 'Cash on Delivery', icon: 'C', needsReceipt: false }` |

Plus on the DB / edge side:
- `orders.payment_method DEFAULT 'cod'::text` — change default to `'gcash'`
- `place-order` edge fn — already CLEAN-ported; no further changes needed
- `dashboard-v2/js/modules/orders.js` — may have filter pills (will check in P3)

### 2. Replace `save-product` and `save-settings` edge fns? — NO, just drop them

Grep result: **zero callers in storefront source**. Confirms skill §4.4's suspicion that the dashboard writes the tables directly. P3 action: delete both from the OLD project (they were never deployed to `mrbeanies-prod`).

### 3. WebAuthn rp_id — server-side fix only

Storefront `auth.js:157` and `auth.js:281` read `rp_id` from the RPC response (`ch.rp_id` and `reg.rp_id`). Storefront does NOT hardcode it. The fix is purely in the RPCs:
- `webauthn_auth_challenge` line `'rp_id', 'mr-greenies-store.netlify.app'`
- `webauthn_register_challenge` line `'rp_id', 'mr-greenies-store.netlify.app'`

P3 will move these to read from `store_settings` (new column `webauthn_rp_id`) so they can be changed without a migration on each domain rotation.

### 4. Hardcoded Supabase URL + anon key in storefront

`storefront/js/core/config.js` lines 5–6:
```
export const SUPABASE_URL  = 'https://ckmnhgattkiziuykhczo.supabase.co';
export const SUPABASE_ANON = 'eyJ…l2ErPyJe6q2sI4UpNtRp9qRfeVkfdrHSOdkensj83IA';
```

P3 doesn't change these (still pointing at the live DB until P4 cutover). P4 swaps both to the new project's values.

### 5. RLS policy duplication on the OLD project

P3 drops the unrestricted overlapping permissive policies on the OLD project so the `is_admin()`-gated ones actually gate writes:
- `orders` → drop `anon insert orders`, `anon read own orders`, `auth full orders`; keep the validated + admin-gated ones
- `products` → drop `anon_manage_products`; keep `products_admin_all` + `products_public_read`
- `store_settings` → drop `anon_manage_store_settings`; keep `settings_admin_write` + `settings_public_read`
- `categories`, `banners`, `announcements`, all `cms_*` — drop the `anon_manage_*` / `Allow CMS writes *` clones that bypass `is_admin()`
- `delivery_zones`, `customer_tiers`, `telegram_users` — same de-duplication

These also need to be replayed on `mrbeanies-prod` (whose schema was reconstructed faithfully — i.e., it has the same policy debt). Both projects get the cleanup in one P3 migration.

### 6. `update-order` hardcoded admin key

`'mrg-admin-2026'` constant in source — replace with `Deno.env.get('UPDATE_ORDER_ADMIN_KEY')` + a proper `is_admin()` RPC check. Re-deploy the function on `mrbeanies-prod`.

### 7. Drop side-project + duplicate edge functions on the OLD project

- `notify-costomer` (typo dup)
- `validate-cutover`
- `cf-*` × 6 (Cardforge)
- `nicolife-auth`
- `ai-proxy`
- `create-payment` (PrimeLabs/Xendit leftover)

P3 deletes these from `ckmnhgattkiziuykhczo`. Skill §G11 noted this is overdue.

### 8. `cms_hero` seed content

Old default has the "Beauty AI Empire Builder" tagline. Deferred to **P5** (data migration / content seed), not P3.

### 9. `netlify.toml`

Add a `netlify.toml` to the repo root that enforces:
- HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin`
- Tight CSP for the storefront
- SPA fallback redirect to `/index.html`
- `build` block (publish = `storefront`)

## What P3 does NOT touch (per your message)

- ❌ No new payment processor — manual GCash/Maya/Bank/USDT receipt-upload stays as-is
- ❌ No `create-payment` replacement — `place-order` + `upload-receipt` are the only payment-related fns needed
- ❌ Telegram secrets — deferred to P8

## Summary

P3 is much narrower than the skill suggested, in your favor. The biggest concrete chunks are:
1. Three-line COD strip in `checkout.js` + `config.js` + DB default
2. RLS policy de-duplication migration (replayed on both projects)
3. Replace WebAuthn `rp_id` hardcoding with a `store_settings` row
4. Delete 11 unused edge functions on the OLD project
5. Add `netlify.toml`

All of it commits onto `recover/storefront` (or onto a fresh `p3/cleanup` branch off `main` after `recover/storefront` is merged).
