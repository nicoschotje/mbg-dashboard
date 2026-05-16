# P0 — Storefront Asset Inventory

Captured: 2026-05-15 (UTC) via `performance.getEntriesByType('resource')` in the live storefront tab.

Origin: `https://newstorefrontmgb1234.netlify.app`

## Source files (deploy artifacts on Netlify CDN — must be recovered into `/storefront`)

### CSS (3)

| Path | Recover to |
|---|---|
| `/css/tokens.css` | `storefront/css/tokens.css` |
| `/css/layout.css` | `storefront/css/layout.css` |
| `/css/components.css` | `storefront/css/components.css` |

### JS — core (4)

| Path | Recover to |
|---|---|
| `/js/core/supabase.js` | `storefront/js/core/supabase.js` |
| `/js/core/utils.js` | `storefront/js/core/utils.js` |
| `/js/core/auth.js` | `storefront/js/core/auth.js` |
| `/js/core/config.js` | `storefront/js/core/config.js` |

### JS — modules (7)

| Path | Recover to | In-repo today? |
|---|---|---|
| `/js/modules/banners.js` | `storefront/js/modules/banners.js` | ❌ |
| `/js/modules/products.js` | `storefront/js/modules/products.js` | ✅ (only file in repo, 140K) |
| `/js/modules/cart.js` | `storefront/js/modules/cart.js` | ❌ |
| `/js/modules/checkout.js` | `storefront/js/modules/checkout.js` | ❌ |
| `/js/modules/tracking.js` | `storefront/js/modules/tracking.js` | ❌ |
| `/js/modules/tiers.js` | `storefront/js/modules/tiers.js` | ❌ |
| `/js/modules/restock.js` | `storefront/js/modules/restock.js` | ❌ |

### Other (1)

| Path | Recover to |
|---|---|
| `/manifest.json` | `storefront/manifest.json` |

### Probably also present (not in resource list because not requested on this page load)

- `/index.html` — the root document itself
- Other HTML pages (checkout, account, etc.) — confirm on recovery
- `/sw.js` or `/service-worker.js` — PWA service worker (skill mentions PWA)
- Icons: `/icon-180.png`, `/icon-192.png`, `/icon-512.png` (or similar) — referenced by manifest
- `/robots.txt`, `/sitemap.xml` (maybe)
- A `main.js` or entry-point JS that imports the modules (not surfaced because it's a module entry, may not appear in Performance API)

## External CDN dependencies (skill §10 says keep CDN pattern, pin versions)

| Dependency | Version observed |
|---|---|
| `@supabase/supabase-js` | `@2` (alias — pin to exact in rebuild) |
| `@supabase/functions-js` | `2.105.4` |
| `@supabase/postgrest-js` | `2.105.4` |
| `@supabase/realtime-js` | `2.105.4` |
| `@supabase/storage-js` | `2.105.4` |
| `@supabase/auth-js` | `2.105.4` |
| `tslib` | `2.8.1` |
| `@supabase/phoenix` | `0.4.2` |
| `iceberg-js` | `0.8.1` |
| Inter + Playfair Display fonts | Google Fonts (via fonts.googleapis.com → fonts.gstatic.com) |

## Recovery — easiest path (user-side)

The Cowork sandbox can't download these files (Chrome MCP blocks raw page text exfiltration; `web_fetch` is gated to URLs the user has named; sandbox proxy doesn't allow `*.netlify.app`). The most reliable recovery is a small user step:

**Option A — Browser Save Page As (5 minutes, gets `/index.html` + linked assets in one shot):**

1. Open https://newstorefrontmgb1234.netlify.app/ in Chrome.
2. File → Save Page As… → choose "Webpage, Complete" → save into a new folder, e.g. `~/Downloads/mbg-storefront-recovered`.
3. Chrome will save `index.html` + an `_files/` folder with CSS/JS/images.
4. Repeat for any other page (open checkout, account, etc., save each).

**Option B — `wget --mirror` locally (most complete, recursively follows links):**

```bash
cd ~/Downloads
mkdir mbg-storefront-recovered && cd mbg-storefront-recovered
wget --mirror --no-parent --page-requisites --adjust-extension \
     --convert-links --restrict-file-names=windows \
     -e robots=off \
     -U "Mozilla/5.0 MBG-Recovery" \
     https://newstorefrontmgb1234.netlify.app/
```

**Option C — One-by-one direct downloads (use the path list above):**

For each path above, open `https://newstorefrontmgb1234.netlify.app/<path>` in a new tab and Save As.

Once you have a folder of files, share it via the cowork directory picker (or paste the path) and I'll move them into `/tmp/work/beauty-ai-empire-builder/storefront/`, commit on `recover/storefront`, and push.

## Why this matters for the rebuild

- P1–P2 (new Supabase project, edge function port) do **not** need storefront source.
- P3 (COD strip + netlify.toml + clean-ups) **does** need source — it edits the storefront's checkout UI and Telegram message templates.
- P4 (parallel Netlify deploy) needs source — that's what we deploy to `mbg-storefront-prod`.

Recovery is therefore on the critical path between P2 and P3, not for P0→P1 gate approval.
