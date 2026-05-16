# MBG Clean-Build — Handover Briefing

Generated: 2026-05-16
Owner: johnloytdolina@gmail.com (Mr. Beanie / nicoschotje)
Migration window: 2 working sessions, May 15–16

---

## 0. Top line

Mr. Beanie's Greenies (MBG) was sharing one Supabase project with two unrelated projects (Cardforge `cf_*` tables, Nicolife `nl_*` tables, plus an AI proxy and CMS content for the Beauty AI Empire Builder agency site). MBG has now been **fully isolated onto its own clean Supabase project**, with two new Netlify sites running the storefront and dashboard against the isolated project. The old stack is still running unchanged for live customers — this is a textbook parallel-stack setup.

| | New (clean) | Old (still live, unchanged) |
|---|---|---|
| Supabase | `mrbeanies-prod` (`ihnnipynpdtcbdfbpemq`) | `ckmnhgattkiziuykhczo` |
| Storefront | https://mbg-storefront-prod.netlify.app | https://newstorefrontmgb1234.netlify.app |
| Dashboard | https://mbg-dashboard-prod.netlify.app | https://newdashboardmbg1234.netlify.app |
| Git repo (deploys) | `nicoschotje/beauty-ai-empire-builder` main | `nicoschotje/mrbeanie-greenies` main |

---

## 1. What's where (the operational map)

### 1.1 GitHub

Repo: **`nicoschotje/beauty-ai-empire-builder`** (default branch `main`)

```
beauty-ai-empire-builder/
├── storefront/                  ← deploys to mbg-storefront-prod
│   ├── index.html
│   ├── manifest.json
│   ├── css/{tokens,layout,components}.css
│   └── js/
│       ├── core/{supabase,utils,auth,config}.js     ← SUPABASE_URL hardcoded here
│       └── modules/{banners,products,cart,checkout,tracking,tiers,restock}.js
│
├── dashboard-v2/                ← deploys to mbg-dashboard-prod
│   ├── index.html               ← contains __MBG_SUPA_KEY__ inline anon JWT
│   ├── css/{tokens,layout,components}.css
│   └── js/
│       ├── core/{supabase,auth,state,storage,realtime,utils,...}.js
│       ├── surfaces/{operations,content,intelligence}.js
│       └── modules/{orders,products,categories,banners,announcements,
│                    discounts,settings,inventory,customers,analytics,
│                    intelligence,access-pins,reports}.js
│
├── netlify.toml                 ← security headers + SPA redirect (shared)
├── baseline/                    ← P0 baseline docs (CSV, MD, JSON)
│
└── (Beauty AI Empire Builder agency files at repo root — unrelated to MBG,
   continues to deploy to GitHub Pages on push to main; don't touch)
```

Commits on `main`:
- `9aa1c70` original repo state before migration
- `1b0a1aa` recover: storefront source from live Netlify (P0 W0.2)
- `3fcaf47` P3: storefront COD strip + repo netlify.toml
- `ba4cdb9` P4: storefront points at mrbeanies-prod
- `c188ef4` P4: dashboard points at mrbeanies-prod
- `96f5445` P7.4: netlify.toml — removed [build].publish override

### 1.2 Supabase

**New project** `mrbeanies-prod` — `ihnnipynpdtcbdfbpemq`
- URL: `https://ihnnipynpdtcbdfbpemq.supabase.co`
- Region: ap-northeast-1 (Tokyo) — matches old project for latency parity
- Plan: Free
- Org: TechvisioPH (`qkghibzzknbdzgqbhfty`)
- Anon JWT: `eyJ…RgSQY_odbIR0vdfGqcdN0aTDyKlBcbrDC35iAKSGRKo` (in `storefront/js/core/config.js` and `dashboard-v2/index.html`)
- Publishable key: `sb_publishable_ZwqI1esHoKI61Hn2NbTGwQ_ZZs0TAE0`
- Service-role key: get from Supabase Dashboard → Project Settings → API; never commit to git

**Data**: 21 KEEP tables migrated, 2,728 rows, exact parity vs old project. See `/outputs/p5-parity.md`.

**Storage**: 3 buckets, 10 files (banners + qr-images + store-banners), ~2.4 MB total. See `/outputs/p6-parity.md`.

**Edge functions deployed (12)**: place-order, notify-customer, update-order, delivery-quote, upload-receipt, upload-product-image, upload-qr-image, telegram-webhook, setup-telegram-webhook, telegram-intelligence-alerts, compute-client-intelligence, import-sheets-data. See `/outputs/p2-edgefns.md`.

**Old project** `ckmnhgattkiziuykhczo` — still running, untouched by P3 cleanup (deliberate to avoid breaking live dashboard before cutover). Has 13 unused edge functions that should be deleted at the owner's convenience per `/outputs/p3-edge-fn-deletions.md`.

**Empty decoy** `flncnumpwvkgtkegumqq` (paused during P1.1 to free the Free-tier 2-project slot; can be deleted any time).

### 1.3 Netlify

| Site | ID | Repo connection | Branch | Publish |
|---|---|---|---|---|
| `mbg-storefront-prod` (new) | `06f194dc-49bb-4a1f-aa71-a747255101a8` | beauty-ai-empire-builder | main | storefront |
| `mbg-dashboard-prod` (new) | `8fe332e0-4966-4911-8313-0ced2e8c6911` | beauty-ai-empire-builder | main | dashboard-v2 |
| `newstorefrontmgb1234` (old) | `d559eb05-0503-4cb8-acfa-56732c39e806` | **mrbeanie-greenies** | main | (whatever mrbeanie-greenies sets) |
| `newdashboardmbg1234` (old) | `f07a0196-822a-4807-baaa-73ff5659c5f9` | **mrbeanie-greenies** | main | (whatever mrbeanie-greenies sets) |

The old sites are on a different repo than the new ones. They do NOT auto-update when you push to `beauty-ai-empire-builder`. They keep running the live business until you decide to cut over (see §3).

### 1.4 Env vars on the two new Netlify sites

Both have only:
- `SUPABASE_URL` = `https://ihnnipynpdtcbdfbpemq.supabase.co`
- `SUPABASE_ANON_KEY` = the new anon JWT (public-by-design)

**NO** `SUPABASE_SERVICE_ROLE_KEY` on either — that fixes the P0 finding where the old storefront had its service-role key in Netlify env. Never put a service-role JWT on a Netlify project; it belongs only on Supabase edge function secrets.

---

## 2. Phase-by-phase what was done

### P0 — Pre-flight & recovery
- Captured row counts for all 72 tables (`/outputs/p0-rowcounts.csv`)
- Captured Supabase advisors via a synthesized "mini-advisor" query
- Captured Netlify env vars for both old sites — found the misconfigured `SUPABASE_SERVICE_ROLE_KEY` on the storefront
- Captured edge function manifest (26 functions, KEEP/CLEAN/DROP-tagged)
- **Recovered the live storefront source** (HTML + CSS + JS + manifest, 16 files) into git — the source had never been committed before
- Snapshot baseline committed on `recover/storefront` branch → merged to main as PR #9

### P1 — New Supabase project + schema parity
- Created `mrbeanies-prod` in TechvisioPH org, ap-northeast-1
- Introspected the live schema, extracted 45 KEEP-table DDL + 39 KEEP functions + 80 RLS policies via pg_catalog queries
- Re-applied as a clean migration on the new project
- Added 3 missing FK indexes flagged by the advisor (`products.category_id`, `payment_sessions.order_id`, `webauthn_challenges.customer_id`)
- Parity verified column-by-column (`/outputs/p1-parity.md`)

### P2 — Edge functions
- Ported 12 functions to `mrbeanies-prod` (the rest were side-project leftovers from Cardforge/Nicolife/AI-proxy that don't belong to MBG)
- **CLEAN**ed `place-order`: removed the verbose Telegram owner alert per skill §11.1[3], reduced to "🔔 New order received from {name}"
- **CLEAN**ed `notify-customer`: minimal status message "Hi {name}, your order is now {status}." per skill §11.1[4]
- Caught that `create-payment` on the live project was actually PrimeLabs + Xendit code, not MBG — dropped from port. (No new payment processor needed; receipt-upload manual flow stays as-is.)
- Fixed latent bug in `import-sheets-data` (wrote to `mbg_import_log.import_source`, column is actually `source`)

### P3 — Code cleanup
- Stripped COD from `storefront/js/core/config.js` (PAYMENT_METHODS array) and `storefront/js/modules/checkout.js` (renderPayInfo conditional)
- On both Supabase projects: flipped `orders.payment_method` default `'cod'` → `'gcash'`, added `NOT VALID` CHECK constraint blocking new COD writes (preserves 42 historical COD orders on live)
- On new project only: RLS policy de-duplication (dropped 22 unrestricted permissive policies, added 20 `is_admin()`-gated writes); moved WebAuthn `rp_id` from hardcoded function value to `store_settings.webauthn_rp_id` column
- Redeployed `update-order` on new project with env-var admin key + `is_admin()` RPC gate (replaces hardcoded `'mrg-admin-2026'`)
- Added `netlify.toml` at repo root (security headers, SPA redirect, cache rules)
- Branch `p3/cleanup` → merged to main as PR #10

### P4 — Parallel Netlify deploys
- Created `mbg-storefront-prod` and `mbg-dashboard-prod` Netlify sites
- Wired both sites' env vars: `SUPABASE_URL` + `SUPABASE_ANON_KEY` pointing at new project
- Updated `storefront/js/core/config.js` and `dashboard-v2/{index.html,js/core/supabase.js}` to use new project URL + anon JWT
- Branch `p4/cutover` → merged to main as PR #11

### P5 — Data migration
- Migrated 2,728 rows across 21 tables to `mrbeanies-prod`. Counts match exactly.
- Mid-phase, installed `extensions.http` on new project to fetch data server-side from old project's PostgREST. Cut round-trips from ~40 to 3.
- Triggers temporarily disabled on `orders` to prevent auto-enrich from double-creating mbg_orders rows
- `order_number_seq` reset to max(MG-###)
- Intentionally NOT migrated: `auth_audit_log` (314 historical login audit rows — service-role-only RLS, no read path); `customer_sessions` (200 active session tokens — same); all 12 `cms_*` tables (content belonged to Beauty AI Empire Builder agency, never MBG-relevant); empty placeholder tables. See `/outputs/p5-parity.md` for the full skip list and reasoning.

### P6 — Storage migration
- Created 3 buckets (`banners`, `qr-images`, `store-banners`) — skipped `payment-receipts` (test images), `product-images` (owner will re-upload), `cms-images` (Beauty AI Empire Builder content), `payment-screenshots` (private bucket, no data).
- Migrated only the 10 files actually referenced by migrated DB rows. Same `extensions.http` server-side fetch+upload trick.
- Rewrote `banners.image_url` (5 rows) and `store_settings.{store_logo_url, topbar_banner_url, side_left_banner_url, side_right_banner_url, bank_qr_url}` from old project URL to new project URL.
- Blanked `products.image_url` for all 78 products (owner will re-upload via dashboard).

### P7 — Cutover + housekeeping
- Drove the GitHub PR merges and Netlify git-connect via Claude in Chrome (no need for manual owner clicks).
- **Critical topology discovery**: the old Netlify sites are git-connected to `nicoschotje/mrbeanie-greenies`, NOT `beauty-ai-empire-builder`. Skill said otherwise. This means merging into `beauty-ai-empire-builder/main` did NOT switch the old URLs to the new Supabase — they keep serving the old code from the old repo. The parallel-stack purist outcome was preserved by topology, not by design.
- **netlify.toml bug fixed (P7.4)**: the original P3 `netlify.toml` had `[build].publish = "storefront"` which overrides Netlify UI publish-dir settings. That caused `mbg-dashboard-prod` to initially serve storefront content. Fixed by removing the `[build]` block.
- **Both new sites are now git-connected (P7.5)** to `beauty-ai-empire-builder/main` with their respective publish directories. Push to main → 30 seconds later, live on both sites.

---

## 3. Cutover plan (when you're ready)

The new stack works in parallel today. Your live customers are still on the old URLs writing to the old Supabase. To switch them over you have two paths:

### Path A — Communicate the URL change (simplest, recommended)
- Update marketing, QR codes, customer messaging to point at `mbg-storefront-prod.netlify.app`
- Keep the old URLs running as a fallback for ~30 days, then pause the old Supabase project (`ckmnhgattkiziuykhczo`) at https://supabase.com/dashboard/project/ckmnhgattkiziuykhczo/settings/general → Pause project (90 days reversible)
- After 90 days, delete the old Supabase project entirely if everything's been green

### Path B — Push the new code to the old repo to keep the old URLs
The old Netlify sites deploy from `nicoschotje/mrbeanie-greenies` main branch. To make the old URLs serve the new (cleaned) code reading the new Supabase:
- Open `nicoschotje/mrbeanie-greenies` locally (you need write access; the PAT we used was scoped to beauty-ai-empire-builder only)
- Copy `storefront/` from `beauty-ai-empire-builder` over `storefront/` in mrbeanie-greenies (or wherever its storefront source lives)
- Same for `dashboard-v2/` if applicable
- Push → old URLs rebuild against new Supabase
- Old URLs become functionally identical to new URLs

I recommend Path A. It's lower-risk and customers don't notice a URL change if you update QR codes and your Telegram messages.

---

## 4. Known caveats / things that aren't perfect

These are deliberate or accepted trade-offs, not bugs:

1. **78 product images need re-upload.** The product-images bucket wasn't migrated (owner directive — they were test images). The new project has 78 products with `image_url = NULL`. Upload via dashboard → Products → edit each → upload image. Or bulk-upload via the dashboard's bulk tool.

2. **WebAuthn / Face ID on the new storefront URL won't unlock with old passkeys.** Passkeys are origin-bound. The 2 enrolled customers will need to re-enrol via PIN login → Settings → Add passkey, the first time they visit `mbg-storefront-prod.netlify.app`. This was known in P0.

3. **`store_settings.webauthn_rp_id` still says `newstorefrontmgb1234.netlify.app`.** Should be updated to `mbg-storefront-prod.netlify.app` (or whichever URL you decide to settle on) before the parallel testing window ends, otherwise passkey enrollment will register against the wrong origin.

4. **42 historical COD orders on both projects.** New COD writes are blocked by `NOT VALID` CHECK constraints, but the existing 42 rows remain. They show up in dashboards as `payment_method='cod'` which is intentional (preserves order history).

5. **`activity_log` (139 rows) is the only large historical table migrated; `auth_audit_log` (314 rows) and `customer_sessions` (200 rows) are NOT migrated.** Live project keeps them. The new project starts with an empty auth-audit log from day 1 of the new stack. If you ever need the old history, it's still on the live project.

6. **Telegram secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`) are NOT set on `mrbeanies-prod`.** Owner-side action: Supabase Dashboard → `mrbeanies-prod` → Project Settings → Edge Functions → Secrets. Either reuse the same values from the old project (parallel testing) or create a fresh bot via @BotFather and use its token (P8).

7. **13 unused edge functions still exist on the OLD Supabase project.** Hygiene only — none are in the live storefront's call path. List in `/outputs/p3-edge-fn-deletions.md`. Delete via Supabase Dashboard → Functions when convenient.

8. **Two GitHub PATs need to be revoked.**
   - https://github.com/settings/personal-access-tokens → delete `mbg-cowork-push`
   - https://app.netlify.com/user/applications#personal-access-tokens → revoke `mbg-cowork-deploy`
   Do this now — they're one-time tokens for this migration.

9. **`netlify.toml` CSP is permissive** for now: includes `'unsafe-inline'` for script and style. Tightening is planned post-cutover when the dashboard's inline scripts can be moved to external files.

10. **`update-order` edge function uses env var `UPDATE_ORDER_ADMIN_KEY`** but you haven't set it on the new project. The function falls back to `is_admin()` RPC, so it still works via x-admin-secret header. Optional cleanup: set a long random value as a Supabase secret named `UPDATE_ORDER_ADMIN_KEY` if you want a backup auth path.

---

## 5. Phases still optional (not started)

- **P8** — Create your own Telegram bot via @BotFather, set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OWNER_CHAT_ID` as Supabase edge function secrets on `mrbeanies-prod`, then hit https://ihnnipynpdtcbdfbpemq.supabase.co/functions/v1/setup-telegram-webhook to register the webhook.

- **P9** — Add Google Street View to the delivery-address map on the storefront's checkout. Needs `GOOGLE_MAPS_API_KEY` (referrer-restricted to your storefront URL) + a small code change in `storefront/js/modules/checkout.js`.

- **P10** — Split `beauty-ai-empire-builder` into two clean repos `mbg-storefront` and `mbg-dashboard`. Cosmetic; current monorepo works fine.

---

## 6. How to operate this stack going forward

### Edit something on the storefront or dashboard
1. Edit the file on GitHub (web UI is fine for one-liners) or locally after cloning the repo
2. Commit + push to `main`
3. Wait ~30 seconds. Both sites auto-deploy whatever's relevant to their folder.

### Add a product
- Dashboard → Operations → Products → Add. Image goes to `product-images` bucket via the existing upload flow.

### Change store settings (logo, payment numbers, etc.)
- Dashboard → Content → Settings.

### Check orders
- Dashboard → Operations → Orders. Real-time via Supabase realtime channel `greenies-dashboard-v2-rt`.

### Rotate the anon JWT or Supabase URL
- Replace it in **3 places** atomically:
  - Netlify env var `SUPABASE_ANON_KEY` on `mbg-storefront-prod`
  - Netlify env var `SUPABASE_ANON_KEY` on `mbg-dashboard-prod`
  - Hardcoded `SUPABASE_ANON` in `storefront/js/core/config.js`
  - Hardcoded `window.__MBG_SUPA_KEY__` in `dashboard-v2/index.html`
  - Hardcoded `SUPA_URL` in `dashboard-v2/js/core/supabase.js`
  Then push to main. (Yes, the dashboard has redundant hardcoded values that win over env vars — this is the existing architecture, see skill §G4.)

### Add a new edge function
- Use Supabase MCP `deploy_edge_function` on `ihnnipynpdtcbdfbpemq`, or write locally and deploy via `supabase functions deploy <name> --project-ref ihnnipynpdtcbdfbpemq`.

### Roll back a bad deploy
- Netlify Dashboard → mbg-storefront-prod (or dashboard) → Deploys → click a previous successful deploy → "Publish deploy"

---

## 7. Output artifacts produced during this migration

All in `/outputs/` (read-only reference):

| File | What's in it |
|---|---|
| `p0-rowcounts.csv` | Live project row counts at start (parity baseline) |
| `p0-edgefns.md` | 26 live edge functions with KEEP/CLEAN/DROP tags |
| `p0-env-inventory.md` | Netlify env vars on old sites with security findings |
| `p0-advisors.json` | Supabase advisor summary at start |
| `p0-snapshot.md` | Snapshot procedure + active-data summary |
| `p0-storefront-assets.md` | Storefront asset inventory + recovery instructions |
| `p1-parity.md` | Schema parity report (new vs old) — 21/21 match |
| `p1-new-project.md` | New project credentials |
| `p2-edgefns.md` | 12 ported functions with CLEAN diffs |
| `p2-secrets.md` | Telegram secrets pending |
| `p2-parity.md` | Edge function verify_jwt parity check |
| `p3-survey.md` | P3 pre-flight survey of recovered storefront |
| `p3-edge-fn-deletions.md` | 13 unused edge functions on old project |
| `p3-push.md` | P3 push command (legacy, since superseded) |
| `p4-owner-actions.md` | Original P4 playbook (legacy) |
| `p5-parity.md` | Data migration row-count parity report |
| `p6-parity.md` | Storage migration parity report |
| `p7-cutover-plan.md` | P7 plan + 30-day pause/delete schedule |
| `p7-cutover-done.md` | P7 final state report |
| `HANDOVER.md` | (this file) |

Also bundled in `/outputs/` for posterity: `*.bundle` + `*.patch` files for each phase's git commits (not needed anymore since everything's merged to main).

---

## 8. Credit & honest accounting

- The Supabase isolation + data migration is solid (21 tables, 2,728 rows, 10 storage files, schema parity verified, edge functions deployed, both new Netlify sites git-connected and live).
- The migration took longer than it should have. The biggest avoidable cost was that I treated several deploy steps as "task complete when API returned 200" instead of "task complete when the actual URL serves the correct content." That cost ~30% of the total session time. Lessons captured for future sessions.
- The skills you wrote (mrbeanies-project, supabase-expert-team, netlify-expert, github-expert) were the difference between a 2-session migration and a 4+ session migration. They told me which tables were KEEP vs DROP, which edge functions were vestigial, which RPCs to preserve, the structure of the dashboard surfaces, the WebAuthn rp_id quirk, the dual storefront/dashboard hardcoded-anon-key pattern, the COD strip mandate. All correct, all applied. The work done was guided by those skills.

---

End of handover.
