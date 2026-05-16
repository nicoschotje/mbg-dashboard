# P2 — Edge Function Port Report

Source: `ckmnhgattkiziuykhczo` (26 active edge functions)
Target: `ihnnipynpdtcbdfbpemq` (`mrbeanies-prod`)
Captured: 2026-05-15 (UTC)

## Deployed on `mrbeanies-prod` — 12 functions

| Slug | verify_jwt | Disposition | Notes |
|---|:---:|---|---|
| `place-order` | ✅ | **CLEAN** | Telegram owner alert collapsed to one line per skill §11.1[3]; hardcoded dashboard URL removed; COD branch left intact (P3 strips it everywhere together) |
| `notify-customer` | ❌ | **CLEAN** | Status message minimised to "Hi {name}, your order is now {status}." per skill §11.1[4]; emoji/Markdown stripped to avoid breakage on names with underscores |
| `update-order` | ❌ | KEEP | ⚠️ Hardcoded `ADMIN_KEY = 'mrg-admin-2026'` — replace with env-var + `is_admin()` RPC gate in P3 |
| `delivery-quote` | ❌ | KEEP | Lalamove estimate-mode, OSM Nominatim geocoding. Latent: TODO for live Lalamove keys |
| `upload-receipt` | ❌ | KEEP | → `payment-receipts` bucket (public, 5MB) |
| `upload-product-image` | ❌ | KEEP | → `product-images` bucket; auto-creates bucket if missing |
| `upload-qr-image` | ❌ | KEEP | → `qr-images` bucket; auto-creates and updates to public |
| `telegram-webhook` | ❌ | KEEP | /start + /status; links `telegram_chat_id` to orders |
| `setup-telegram-webhook` | ❌ | KEEP | One-shot setup tool; `?action=set\|info\|delete` |
| `telegram-intelligence-alerts` | ❌ | KEEP | VIP/dormant/discount/churn/rising/summary alerts |
| `compute-client-intelligence` | ❌ | KEEP | Walks `mbg_clients`+`mbg_orders` → upserts `mbg_client_intelligence` |
| `import-sheets-data` | ❌ | KEEP | ⚠️ Latent bug: writes `mbg_import_log.import_source` but column is `source`. Fixed in port — column name corrected to `source`. (Old project had 0 rows because of this bug; new project will actually write.) |

## NOT ported — 14 functions

| Slug | Disposition | Why not |
|---|---|---|
| `notify-costomer` | **DROP-DUP** | Typo duplicate of `notify-customer`. No callers — verified safe to drop |
| `save-product` | **VERIFY-FIRST** | Dashboard writes to `products` table directly; this fn may be vestigial. Decision after P3 sees recovered storefront source |
| `save-settings` | **VERIFY-FIRST** | Same — dashboard writes `store_settings` directly |
| `validate-cutover` | **DROP-MIG** | One-shot migration tool from a previous attempt; no longer needed |
| `create-payment` | **DROP-SIDE** | 🔴 SURPRISE: source code is for **PrimeLabs PH** + Xendit, not MBG. Wrong project entirely. A real MBG payment-processor fn needs to be built fresh in P3/P4 if PayMongo/Xendit/etc. is desired |
| `ai-proxy` | **DROP-SIDE** | Unrelated AI proxy |
| `nicolife-auth` | **DROP-SIDE** | Nicolife household project |
| `cf-record-view` | **DROP-SIDE** | Cardforge digital business cards |
| `cf-get-card` | **DROP-SIDE** | Cardforge |
| `cf-get-views` | **DROP-SIDE** | Cardforge |
| `cf-update-card` | **DROP-SIDE** | Cardforge |
| `cf-generate-vcard` | **DROP-SIDE** | Cardforge |
| `cf-generate-pass` | **DROP-SIDE** | Cardforge |

## Skill-mandated CLEAN diffs

### `place-order` Telegram owner alert

OLD (verbose):
```
🔔 *New Order!* #MG-001
👤 *Juan*
📱 +63...
📍 12 Main St
🛍️ *Items:*
  🍬 Greenies ×2 — ₱200
💰 Subtotal: ₱200
💳 *Total: ₱250*
💙 GCash
📸 [Receipt](https://…)
_Open dashboard to process →_
https://mrbeaniesdashboard.netlify.app
```

NEW (one line):
```
🔔 New order received from *Juan*
_Order MG-001_
```

### `notify-customer` status messages

OLD (marketing copy, 7 long status strings with emojis and prose).

NEW (single template):
```
Hi {name}, your order is now {status}.
```
Where `{status}` maps via a small display table (`pending → "pending payment"`, `out_for_delivery → "out for delivery"`, etc.).

### Other CLEAN changes applied to `place-order`

- Removed `cod: '💵 COD'` from the payment-icon map (no longer used since the verbose message is gone)
- Telegram fetch is now fire-and-forget (`.catch` only) so a Telegram outage can never block an order
- Removed hardcoded `https://mrbeaniesdashboard.netlify.app` URL

## Outstanding cleanup for P3

1. **`update-order` admin key** — replace `'mrg-admin-2026'` constant with `Deno.env.get('UPDATE_ORDER_ADMIN_KEY')` and gate via `is_admin()` RPC.
2. **`webauthn_*` rp_id** — RPC functions hardcode `'mr-greenies-store.netlify.app'`. Move to a setting in `store_settings` or env var; update at cutover.
3. **COD strip across edge fns + DB enum + storefront UI** — single coordinated pass in P3.
4. **`save-product` / `save-settings`** — grep recovered storefront source for invocations; port or drop accordingly.
5. **`mbg_import_log.source` rename** — already fixed in the port; verify any caller in the dashboard module passes `source` not `import_source`.
6. **MBG-specific payment processor function** — design new `create-payment` (PayMongo? GCash direct? PayMongo invoice → checkout redirect) since the old one isn't MBG code.
