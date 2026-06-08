# MBG Dashboard — Full-Scale Audit & Repair

**Audited:** 2026-06-08 · **Branch:** `claude/gallant-hamilton-gL697` ·
**Live code:** `js2/` (confirmed — `index.html` line 207 loads `./js2/main.js`) ·
**Supabase project:** `ihnnipynpdtcbdfbpemq` ·
**Method:** static code review of every file in `js2/` + live read-only verification
against the production database via the Supabase MCP.

> **Honesty note on scope.** This audit was performed in a headless server
> environment. I could **not** run the dashboard in a real browser, log in with
> the PIN, click through the UI, or capture screenshots / 375px renders. Every
> claim below is grounded in (a) the actual source code and (b) live SQL against
> the production database — not a running UI. Items that genuinely require a
> human at a browser (visual layout, modal behaviour on a phone, the sound/flash
> on a real order) are marked **“needs browser QA”** and should be exercised by
> the owner/maintainer before this is considered fully signed off.

---

## ⚠️ FOR THE OWNER — plain English, read this first

1. **Your dashboard can be opened by anyone who types `123456`.** That is the
   factory-default owner code, and it still works on any phone or computer — and
   it gives that person *full* control (orders, prices, customers, settings).
   The “real” owner code that was set at some point is effectively bypassed.
   **This is the most serious problem found.** See P0-1 below.
2. **The staff (sales) code is still `1234`** — also the factory default. Anyone
   who guesses it gets the sales view. See P0-1.
3. **This is being fixed now.** You gave me your new codes, so I’ve set them up and
   rewritten the login so the old defaults no longer work. There’s a safe 3-step
   changeover (see “Remediation status” below) because the dashboard shares one
   database with your shop — the last step, which kills `123456` for good, runs
   right after this update goes live so your current login doesn’t break in the
   meantime. **Your new codes already work on the test preview link.**
4. **Your Telegram bot token and your customer list are technically readable by
   the public.** Nobody is necessarily abusing this, but it should be locked
   down. See P0-3.
5. **Good news:** orders, products, discounts, payments, inventory, the CRM and
   the new-order alerts are wired up correctly and read/write the right data.
   Several smaller bugs were found and the safe ones are fixed in this branch
   (see the changelog at the very bottom). The brief I was given contained a few
   out-of-date “facts” (e.g. that the dashboard reads the wrong orders column, or
   that a promo is “₱2000 off”); I checked each against the live database and the
   reality is documented here.

---

## Severity legend
- **P0** — security or data-integrity hole (credential/secret leak, RLS hole,
  role bypass, money/stock corruption).
- **P1** — a feature is broken (won’t load, save fails, wrong data).
- **P2** — UX / mobile / config defect.
- **P3** — coded-wrong / tech-debt / dead code (works today but fragile or wrong-shaped).

**Status key:** ✅ fixed in this branch · 🔶 documented, needs owner decision /
coordination (not auto-applied because it touches live auth or the storefront) ·
📝 documented, deferred with reason.

---

## Surface → module → data map (Phase 1 inventory)

`index.html` mounts three “surfaces”, each lazy-loading modules from `js2/modules/`.

| Surface | Module | Reads | Writes | RPC / Edge fn |
|---|---|---|---|---|
| **Operations** (`surfaces/operations.js`) | `orders.js` | `orders` (`*`, filters on `order_status`, renders `items`) | `orders` (status/paid/notes/receipt) | `delete_order` RPC; `notify-customer` edge fn |
| | `inventory.js` | `products`, `restock_notifications` | `products`, `restock_notifications` | — |
| | `customers.js` | `orders` (aggregated by phone), `customer_tiers` | `customer_tiers` (upsert) | — |
| **Content** (`surfaces/content.js`, owner-only) | `products.js` | `products`, `categories`, `subcategories`, `product_variants` | `products`, `product_variants` | `uploadProductImage` (storage) |
| | `categories.js` | `categories` (+`products(count)`) | `categories` | — |
| | `subcategories.js` | `categories`, `subcategories` | `subcategories` | — |
| | `banners.js` | `banners`, `categories` | `banners` | `uploadBannerImage` (storage) |
| | `announcements.js` | `announcements` | `announcements` | — |
| | `discounts.js` | `discount_rules`, `categories`, `products` | `discount_rules` | — |
| | `settings.js` | `store_settings`, `delivery_zones`, `dashboard_settings` (`TIER_CONFIG`, `store_open_override`) | `store_settings`, `delivery_zones`, `dashboard_settings` (incl. `OWNER_PIN_HASH`/`SALES_PIN_HASH`) | `uploadStoreLogo`/`uploadQR` (storage) |
| **Intelligence** (`surfaces/intelligence.js`, owner-only) | `analytics.js` | `orders`, `products`, `product_costs`, `categories` | `dashboard_settings` (`analytics_snapshot`) | — (Chart.js) |
| | `intelligence.js` | `mbg_client_intelligence`, `mbg_import_log`, `mbg_orders` | deletes `mbg_*` (reset) | `import-sheets-data`, `compute-client-intelligence` edge fns |
| | `access-pins.js` | `list_store_customers` RPC | — | `create_store_customer`, `reset_customer_pin`, `update_customer_address`, `toggle_customer_active`, `unlock_store_customer`, `delete_store_customer` RPCs |
| | `reports.js` | `orders`, `products`, `customer_tiers` | — | — |

Core: `supabase.js` (client + `x-admin-secret` header), `auth.js` (PIN/session/idle),
`state.js` (`AppState` event bus), `realtime.js` (channel `greenies-dashboard-v2-rt`),
`storage.js` (resize+upload), `settings.js` (branding), `utils.js` (helpers),
`toast.js`, `chart-loader.js`.

**Dead code:** the entire top-level `js/` directory is an unreferenced duplicate of
`js2/` (see P3-1).

---

# P0 — Security / data integrity

## P0-1 — Factory-default credentials are live, and there is a hardcoded admin backdoor

**Type:** security · **Status:** ✅ RESOLVED on live 2026-06-08 (PR #20 + Step C). New
PINs set, login verifies server-side, and the `admin_config` master-key branch is removed
from `is_admin()`. Verified: `123456`/`1234` rejected, `748306`/`1402` work. See
“Remediation status” below.

This is three overlapping problems that together make `123456` a universal master key.

**(a) The server-side admin gate accepts `123456`.**
`is_admin()` (the gate behind every owner write) checks the `x-admin-secret`
header’s SHA-256 against two stored values:
```
SELECT value INTO v_stored FROM dashboard_settings WHERE key='OWNER_PIN_HASH';   -- = 3ea87a56…
SELECT admin_secret_hash INTO v_stored FROM admin_config WHERE id=1;             -- = 8d969eef…
```
Verified live: `admin_config.admin_secret_hash = 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92`,
which is exactly `sha256('123456')`. So **`x-admin-secret: 123456` ⇒ `is_admin()=true` ⇒ full owner write access**, regardless of what the “real” owner PIN is.

**(b) The client login also falls back to `123456` / `1234`.**
`js2/core/auth.js` defines `DEFAULT_OWNER_PIN='123456'`, `DEFAULT_SALES_PIN='1234'`
(lines 17-18). `loadStoredHashes()` (lines 53-82) tries to read the PIN hashes from
`dashboard_settings` *with the anon key, before login*. But the RLS policy
`dashboard_settings_safe_read` explicitly **hides** `OWNER_PIN_HASH`/`SALES_PIN_HASH`
from non-admins:
```
qual: is_admin() OR (key <> ALL (ARRAY['OWNER_PIN_HASH','SALES_PIN_HASH', …]))
```
So pre-login the read returns *nothing*, `localStorage` is empty on a fresh device,
and the code seeds `hashPIN('123456')` / `hashPIN('1234')`. **Result: on any fresh
browser/phone, `123456` (owner) and `1234` (sales) log in** — and `123456` then
becomes the `x-admin-secret`, which (a) accepts. Master key confirmed end-to-end.

**(c) The sales PIN is the literal default.**
Verified live: `SALES_PIN_HASH = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4 = sha256('1234')`.

**Note on the brief’s claim.** The brief stated “`OWNER_PIN_HASH` is still `123456`.”
Not exactly — `OWNER_PIN_HASH` is actually `3ea87a56…` (some other PIN that was set
once). But that value is *dead weight*: the client can’t read it (RLS), so login
ignores it; and `is_admin()` is satisfied by the `admin_config` backdoor anyway. So
the brief’s **conclusion (P0, `123456` works) is correct**, the mechanism is deeper.

**Evidence:** `auth.js:17-18,53-128`; `is_admin()` definition; `admin_config` row;
`dashboard_settings` rows; `dashboard_settings_safe_read` policy.

**Remediation (the proper fix — see “Action required” at the bottom):**
1. Owner picks a **new 6-digit owner PIN** and a **new 4-digit sales PIN**.
2. Update **both** `dashboard_settings.OWNER_PIN_HASH` **and**
   `admin_config.admin_secret_hash` to the new owner hash (so the `123456`
   backdoor dies), and `SALES_PIN_HASH` to the new sales hash.
3. Switch `auth.js` to verify the owner PIN **server-side** via the existing
   `verify_owner_pin(p_pin,…)` RPC (it already reads the hidden hash and issues an
   `admin_sessions` token usable as `x-admin-token`), and **remove the
   `123456`/`1234` client fallback**. This closes (b) permanently.

This is **not auto-applied** because it changes the live login of a real store and
I cannot browser-test it here; doing it wrong locks the owner out. The exact SQL +
the `auth.js` diff are ready and will be applied as soon as the owner confirms the
new codes.

## P0-2 — “Change PIN” in Settings cannot actually close the backdoor (and may be unusable)

**Type:** security / functional · **Status:** 🔶 (fixed as part of P0-1 remediation)

`js2/modules/settings.js` has a **PIN Management** card (lines 392-407, 948-1001).
Two real problems:

- **It never updates `admin_config.admin_secret_hash`.** It upserts only
  `OWNER_PIN_HASH` (line 956-958). So even after the owner dutifully sets a new
  PIN, the `sha256('123456')` row in `admin_config` keeps granting admin forever.
  The brief’s recommended first action (“owner sets a new PIN”) therefore does
  **not** secure the dashboard on its own.
- **`verifyOwnerPIN()` (lines 993-1001) checks the *real* `OWNER_PIN_HASH` (`3ea87a56…`).**
  An owner who logged in with `123456` doesn’t know the PIN that matches that hash,
  so the “current owner PIN” check fails and the form refuses to save. i.e. the one
  UI that’s supposed to fix P0-1 is itself blocked by P0-1.

**Fix:** folded into the P0-1 remediation — after the credentials are reset and the
backdoor removed, the Settings PIN-change should also write `admin_config` (or
`is_admin()` should drop the `admin_config`/`OWNER_PIN_HASH` dual-source and rely on
`admin_sessions` tokens only).

## P0-3 — Secrets and customer PII are readable with the public anon key (RLS holes)

**Type:** security · **Status:** ✅ CRM + discount_codes locked down on live (2026-06-08);
🔶 Telegram token columns pending (Step 3 — waits on storefront PR #26 + token rotation).

**Done (verified live):** all 8 MBG CRM tables (`mbg_clients`, `mbg_client_intelligence`,
`mbg_orders`, `mbg_order_enrichments`, `mbg_interactions`, `mbg_discounts`,
`mbg_tier_history`, `mbg_import_log`) — SELECT changed from `USING (true)` →
`USING (is_admin())` (migration `lock_down_mbg_crm_anon_read`). Plus `discount_codes`
(empty, unused placeholder) → `is_admin()` (migration `lock_down_discount_codes_anon_read`).
A `pg_policies` sweep confirms the only remaining public `USING(true)` SELECT policies are
catalog/CMS/`store_settings` (intended public). Repo migration files added under
`supabase/migrations/` to prevent drift.

The anon key is public (it’s in `index.html` and the storefront — that part is fine).
The problem is *what that key can read*:

- **`store_settings` exposes the Telegram bot token.** Policy `settings_public_read`
  is `SELECT … USING (true)` for `public`, and the row contains
  `telegram_bot_token = 8878163906:AAF…` (live) and `telegram_chat_id`. Anyone with
  the anon key can `select telegram_bot_token from store_settings`. A leaked bot
  token lets an attacker send messages as the store. **Recommend:** move the token
  to a server-only table / Edge Function secret, or split `store_settings` into a
  public view (branding/payment display) + a private table (tokens), and have the
  dashboard read the token via an admin-gated path.
- **`mbg_clients` (23 rows) and `mbg_client_intelligence` (208 rows) are anon-readable**
  (`Allow anon read … USING (true)`). That’s the full customer CRM — names, phones,
  spend, behaviour tags. Anyone with the anon key can dump it. **Recommend:** change
  these SELECT policies to `USING (is_admin())`. The dashboard reads them while
  logged in as owner (`is_admin()=true`), so it keeps working; the storefront almost
  certainly does not read them.

Ready-to-run SQL is in `supabase/migrations/` (see P0-5) but is left **unapplied**
pending confirmation that the storefront doesn’t depend on these reads.

## P0-4 — `auth_audit_log` (WORM) accepts anonymous inserts; `customer_remember_tokens` has RLS-with-no-policy

**Type:** security · **Status:** 📝 documented (shared-infra; low dashboard impact)

From `get_advisors(security)`:
- `auth_audit_log` policy `audit_anon_insert` is `INSERT … WITH CHECK (true)` for
  `anon` → anyone can spam/garbage the audit log (a WORM table the brief says must
  stay clean). Recommend constraining the insert (e.g. require a matching action
  shape, or route audit writes only through SECURITY DEFINER RPCs).
- `customer_remember_tokens` has RLS enabled but **no policy** → it denies all
  non-service access (functionally safe, but flagged; add an explicit deny/August
  comment or a scoped policy).
- 35 `SECURITY DEFINER` functions are executable by `anon`/`authenticated`,
  including sensitive ones (`get_totp_secret`, `enroll_owner_totp`,
  `consume_totp_recovery_code`, `is_admin`, `export_customer_data`). Most must be
  anon-callable by design (login/verify flows), but `get_totp_secret`,
  `enroll_owner_totp` and `export_customer_data` should be re-checked to confirm they
  gate on `is_admin()`/a valid session *internally*. Full list in
  `migration-notes` / advisor output.

These live in the shared Supabase project (also used by the storefront), so they are
called out for the DBA/owner rather than “fixed” from the dashboard repo.

## P0-5 — Remediation SQL (additive, NOT auto-applied)

Ready-to-run, heavily-commented SQL for P0-1/P0-2/P0-3/P0-4 lives in
**`supabase/remediation/audit-2026-06-08.sql`** — deliberately placed *outside*
`supabase/migrations/` so `supabase db push` won’t auto-apply it. Each block has a
verification step and a caution note. They are **not** run against production by
this audit.

---

# P1 — Broken features / latent correctness

## P1-1 — Analytics “vs previous period” profit & margin are wrong

**Type:** functional bug · **Status:** ✅ fixed

`js2/modules/analytics.js` loads the *current* period orders with `items` (so COGS is
computed), but the **previous-period** query selects a reduced column set that omits
`items`. With no items, previous-period COGS = 0, so previous **profit ≈ revenue** and
**margin ≈ 100%**, which makes the “▲/▼ vs previous period” deltas on Profit and Margin
meaningless. Revenue/orders deltas were fine.

**Fix:** include `items` (and the cost-bearing columns) in the previous-period select
so COGS and therefore profit/margin compare like-for-like. (Revenue numbers verified
against live data: 30-day snapshot revenue ₱73,595 / 22 orders matches
`dashboard_settings.analytics_snapshot`.)

## P1-2 — Role gate is client-side only; CRM reads are not server-gated

**Type:** security / functional · **Status:** 🔶 (the *read* exposure is P0-3; the gate itself is P2-class because writes ARE server-gated)

The sales→owner gate is enforced in three client places (`main.js:139-187`,
`surfaces/operations.js:111-116`) by hiding nav and early-returning. It is **not**
enforced server-side for *navigation*. However:
- **Owner writes are safe:** a sales session carries no admin secret
  (`auth.js:125` → `effectiveSecret=''` for sales), so `is_admin()=false` and every
  owner write is rejected by RLS. I could not find a way for sales to perform an
  owner *write*.
- **Owner *reads* are not all safe:** because of P0-3, the CRM tables are anon-readable,
  so a sales user who forces the client state (or literally anyone with the anon key)
  can read CRM data. The real fix is P0-3 (RLS), not the client gate.

So: the gate is “cosmetic” for reads but solid for writes. Closing P0-3 closes the
meaningful part of this.

---

# P2 — UX / mobile / config

## P2-1 — COD remnant in the Orders payment filter

**Type:** config / UX · **Status:** ✅ fixed

The store takes Bank Transfer + USDT only (verified: `store_settings.gcash_enabled=false`,
`maya_enabled=false`, `crypto_enabled=true`, no COD field anywhere). But
`js2/modules/orders.js` still offered `<option value="cod">COD (legacy)</option>` in
the payment filter (line 575) and listed `cod` in a code comment (line 20). Removed the
COD option (kept the harmless gcash/maya options since those toggles exist and could be
re-enabled). No order data uses `cod`.

## P2-2 — Several Supabase errors are silently swallowed

**Type:** robustness · **Status:** ✅ fixed (the safe ones)

- `inventory.js:40` — `loadRestocks` did `if (error) return;` with no toast/log; a
  failed restock query just showed an empty list. Now logs + toasts.
- `analytics.js` — the `categories` load ignored its `error`; the snapshot upsert
  swallowed errors via `.catch(()=>{})`. Now logged (snapshot stays non-blocking by
  design — a failed cache write should never block the dashboard).
- `intelligence.js` — `openClientDetail` ignored the order-history `error`. Now logged.

## P2-3 — Mobile (375px) — needs browser QA

**Type:** mobile · **Status:** 📝 needs browser QA

I could not render the UI. Code review shows the data-heavy tables (Access PINs,
inventory) wrap in `overflow-x:auto` containers and the layout uses flex-wrap and
`field-row` flex-basis, which is the right pattern. There is a built-in **mobile
preview toggle** (`main.js:268-284`, the 📱 header button) the owner can use. Please
verify on a real 375px phone: Orders detail modal, Settings cards, the Access-PINs
table, and the discount form. No code-level overflow bug was found, but this is the
one area that genuinely needs eyes on a device.

---

# P3 — Tech-debt / dead code / coded-wrong

## P3-1 — Dead `js/` directory (the #1 footgun)

**Type:** dead code · **Status:** ✅ fixed (removed)

`index.html` loads `./js2/main.js`. The top-level `js/` directory is a complete,
unreferenced duplicate of `js2/` left over from the migration — exactly the trap that
caused past sessions to “fix” files that were never live. Nothing references `js/`
(verified by grep). **Removed the entire `js/` directory** and the now-dead
`[[headers]] for="/js/*"` block in `netlify.toml`.

## P3-2 — Anon key lives in two places

**Type:** config · **Status:** 📝 documented

The anon key is set in `index.html` (`window.__MBG_SUPA_KEY__`) and read by
`js2/core/supabase.js` (with a `'PUBLIC_ANON_KEY_PLACEHOLDER'` fallback + a stale
comment “Replace … when wiring to a real environment”). Both resolve to project
`ihnnipynpdtcbdfbpemq` and agree today (the HTML value wins; the placeholder only
matters if the script tag is missing). Low risk. Left as-is to avoid churn, but if the
key is ever rotated, **both** spots must change. The stale comment could be tidied.

## P3-3 — Three different tier-threshold definitions

**Type:** coded-wrong / data-consistency · **Status:** ✅ resolved — single source of truth.
Owner confirmed the authoritative ladder is their live Settings value
**₱5k/10k/15k/25k/50k**. `customers.js` now derives the tier from
`dashboard_settings.TIER_CONFIG` via the new `tierFromConfig()` helper (replacing the
hardcoded `calcTier` ₱500/2k/5k/10k); `settings.js` `DEFAULT_TIERS` fallback aligned to
the same ladder. (The Intelligence CRM already shows the server-computed `lifetime_tier`;
if its edge-function ladder ever diverges from `TIER_CONFIG`, that’s a separate server
follow-up.) Note: the live `TIER_CONFIG` value was **not** changed — only the code that
reads it. The Operations “Clients” tab badges will now match Settings (most customers
move toward Seedling vs the old ₱500/2k/5k/10k computation, as intended).

There are **three** disagreeing tier ladders in play:
- `utils.calcTier()` (used by `customers.js`): ₱500 / 2k / 5k / 10k.
- `settings.js DEFAULT_TIERS`: ₱0 / 500 / 2k / 5k / 10k.
- Live `dashboard_settings.TIER_CONFIG` (what Settings actually saved): ₱5k / 10k / 15k / 25k / 50k.

Meanwhile the **Intelligence** CRM (`intelligence.js`) ignores all of these and renders
the server-computed `lifetime_tier`. So the “Clients” tab (Operations) and the “MBG
Clients” tab (Intelligence) can show different tiers for the same person.

The brief asserted the thresholds are ₱500/2k/5k/10k; the **live config disagrees**. I
did **not** change `calcTier` because which ladder is “business-correct” is the owner’s
call, and `customer_tiers` is currently empty (0 rows) so the Operations tier badges are
purely cosmetic today. **Recommendation:** make `customers.js` read the live
`TIER_CONFIG` (single source of truth) instead of the hardcoded `calcTier`, and align
`settings.DEFAULT_TIERS` to match. Flagged for a follow-up once the owner confirms the
intended ladder.

## P3-4 — Revenue/profit/margin aggregation done in the browser (architecture)

**Type:** architecture / tech-debt · **Status:** 📝 documented (large change, deferred)

`analytics.js`, `reports.js` and `intelligence.js` compute revenue/COGS/profit/margin
with client-side `reduce`/`forEach` over `orders.items`. The brief’s §2.4 says SQL
aggregation belongs in Postgres RPCs. This works today and matches the live snapshot,
but it (a) duplicates the same math in three files and (b) pulls up to 2,000 order rows
to the browser. **Recommendation:** add a single `analytics_summary(period)` RPC and
have all three call it. Deferred — it’s a sizable change with no current correctness
bug (P1-1 aside, now fixed), so it shouldn’t ride in a security PR.

## P3-5 — `intelligence.js` “Reset” uses an unfiltered DELETE

**Type:** fragile / possibly-broken · **Status:** 📝 documented (destructive — intentionally not “fixed”)

The CRM reset loops `sb.from(table).delete()` with **no `WHERE`** (`intelligence.js:438`).
PostgREST rejects unfiltered DELETEs by default, so this feature likely errors out
rather than wiping data. I deliberately did **not** make a “wipe all CRM” button *work*
— if anything that’s a safety feature. Documented so the owner knows the Reset button
may not do anything; if it’s wanted, it should get an explicit confirm + a scoped delete.

## P3-6 — Minor module nits

**Type:** tech-debt · **Status:** 📝 documented

- `customers.js` writes `customer_tiers` directly (`upsert`, line 222). This is allowed
  (it’s **not** `store_customers`, and it’s `is_admin()`-gated), but note the dashboard
  now has two parallel CRM stores: `customer_tiers` (Operations, empty) vs `mbg_clients`
  (Intelligence, populated). Worth consolidating eventually.
- `categories.js` emits `categories:changed` on save but not on delete/move — other
  modules won’t refresh on a category delete/reorder.
- `subcategories.js` has no product-reference guard on delete (categories.js does) →
  could orphan `products.subcategory_id`.
- `announcements.js` type-change unconditionally overwrites custom colours despite a
  comment saying it checks first.
- `intelligence.js` action-tag is rendered into a class/label with `|| c.action_tag`
  fallback unescaped (currently safe — server-controlled enum). ✅ Hardened with
  `escapeHTML` defensively in this branch.

---

# Verified-GOOD (no change needed) — “trust nothing, verify yourself” results

These were checked against live code + data and are **correct**, contrary to some
assumptions in the brief:

- **Orders columns.** All 24 live orders have `items` populated and `order_items`
  empty; `status` ≡ `order_status` for every row (kept in sync by the
  `sync_order_status_columns` trigger). The dashboard correctly **filters on
  `order_status` and renders `items`** (`orders.js:51,88,300,518`). Switching to
  `order_items` (as the brief suggested) would have **blanked every order’s line
  items** — explicitly NOT done.
- **No `service_role` key or admin secret in any shipped file.** Only the anon key +
  the `x-admin-secret` header (which is the owner’s PIN). ✅
- **No direct `store_customers` writes anywhere.** All customer-account mutations go
  through the RPCs (`access-pins.js`), and `list_store_customers` returns safe fields
  only. ✅
- **XSS.** A line-by-line pass over every `innerHTML`/template-literal sink found
  **zero** unescaped DB/user strings — the code consistently wraps them in
  `escapeHTML()`, and `toast()` uses `textContent`. ✅
- **Discounts.** The simplified form behaves per spec: the value field relabels
  Percent %/Amount ₱/hidden-for-free-delivery (`discounts.js:279-301`), save blocks
  empty and >100% percent (lines 338-346), `max_discount_cap` is saved `null`
  (line 370), and product/category scope round-trips. The live `MBGFLOWERS*` rules are
  **fixed ₱4,000 off, category=Flowers, min ₱14,000** (the brief’s “₱2,000 / min ₱7,000”
  was stale) and edit/round-trip correctly through the form. `mbg_discounts` is a
  per-order discount *log*, not a competing rules table — no parity conflict.
- **Payments.** `store_settings` confirms Bank Transfer + USDT enabled, GCash/Maya
  disabled, no COD field. `settings.js` toggles map to the real columns
  (`gcash_enabled`/`maya_enabled`/`crypto_enabled`). ✅
- **Realtime.** Subscribes to channel `greenies-dashboard-v2-rt` with INSERT/UPDATE on
  `orders` + `payment_verifications`, sound+flash+badge on new order, and 5/10/20s
  backoff retry (`realtime.js`). Sales gets the orders-only subset. (Live alert
  needs browser QA to *hear* the sound, but the wiring is correct.)
- **Image uploads** all go through `core/storage.js` (resize/EXIF/recompress) — no
  module bypasses it.

---

## Remediation status — P0-1 / P0-2 (cutover in progress)

The owner supplied new PINs, so the fix is being applied as a safe 3-step cutover
(the dashboard and the live storefront share one DB, so the backdoor can only be
removed once the new login code is live — otherwise the current `123456` login breaks):

- **Step A — DONE (no live disruption).** `OWNER_PIN_HASH` and `SALES_PIN_HASH` rotated
  to the new PINs; `verify_sales_pin` RPC added. `admin_config` left **untouched** so the
  current live code keeps logging in with `123456` until the new code ships.
- **Step B — in this PR.** `js2/core/auth.js` rewritten to verify server-side
  (`verify_owner_pin` / `verify_sales_pin`) with **no** `123456`/`1234` fallback. Verified
  server-side: the new owner & sales PINs are accepted and the old defaults are rejected.
  **Test it on the deploy preview** before merging.
- **Step C — DONE (live, 2026-06-08).** PR #20 was merged & deployed; owner confirmed
  `748306` logs in and `123456` is rejected on live. `is_admin()` redefined to drop the
  `admin_config` branch (migrations `harden_is_admin_drop_admin_config_backdoor` /
  `harden_is_admin_clean_comment`). Verified in SQL: `is_admin()` no longer reads
  `admin_config`/`admin_secret_hash`, defaults closed (false with no headers), and
  `verify_owner_pin`/`verify_sales_pin` accept `748306`/`1402` and reject `123456`/`1234`.
  The backdoor is closed **and** Settings PIN changes now fully rotate admin (P0-2),
  since admin keys only on `OWNER_PIN_HASH`. `admin_config.admin_secret_hash` is now
  unread (dead value); it can be nulled at leisure but is harmless.

**So:** P0-1 and P0-2 are closed on live. `123456`/`1234` no longer work anywhere
(UI login *or* direct API). Owner should still do the two follow-ups in the changelog.

---

## Continuation log — 2026-06-08 (DB security remediation)

Runbook Steps 1, 2/C and 5 are done and verified on live; Steps 3 & 4 are gated on
external dependencies.

| Runbook step | What was exposed | Now | Verified how |
|---|---|---|---|
| **1 — CRM lockdown** | 8 `mbg_*` CRM tables + `discount_codes` readable by the public anon key | SELECT now `is_admin()`-only | `pg_policies` sweep: no customer/business table has a `USING(true)` read; only catalog/CMS/`store_settings` stay public |
| **2 / C — master-key backdoor** | `is_admin()` accepted `x-admin-secret: 123456` via `admin_config`; client also fell back to `123456`/`1234` | server-side `verify_owner_pin`/`verify_sales_pin` login (PR #20) + `is_admin()` no longer reads `admin_config` | live SQL: `is_admin()` defaults closed, `748306`/`1402` ✓, `123456`/`1234` ✗; owner confirmed on live UI |
| **5 — tier ladder** | 3 disagreeing tier ladders | all dashboard screens read one source (`dashboard_settings.TIER_CONFIG`); owner kept ₱5k/10k/15k/25k/50k | code reads `tierFromConfig()`; live `TIER_CONFIG` value unchanged |
| **3 — Telegram token columns** | `store_settings.telegram_bot_token`/`chat_id` readable by anon | ⏸ **pending** | waits on storefront PR #26 live + owner rotating the bot token |
| **4 — anon-callable functions** | 43 `SECURITY DEFINER` fns executable by anon (incl. `get_totp_secret`) | ⏸ **pending** | waits on `STOREFRONT-DB-DEPENDENCIES.md` (not yet in repo) before any `REVOKE` |

### Plain-English owner changelog (continuation)
- **Your customer list is now private.** Previously anyone with the public web key could
  download your CRM (names, phones, spend). That’s now locked to the owner login.
- **The `123456` master key is dead.** The dashboard now checks your PIN on the server,
  and the hidden database master-key was removed. Only `748306` (owner) / `1402` (sales)
  work, on any device. Changing your PIN in Settings now actually sticks.
- **Two things still for you to do:**
  1. **Rotate the Telegram bot token** in @BotFather and put the new token only in the
     edge-function secret (not in the settings table). Tell me when done + when the
     storefront update (PR #26) is live, and I’ll lock the token columns away from the
     public key (Step 3).
  2. **Change your owner PIN once more in Settings** — `748306` was typed into this chat,
     so pick a fresh 6-digit code. It will now take effect immediately (the old bug that
     made PIN changes ineffective is fixed).
- **Still queued:** locking down 43 database functions (Step 4) — I’ll do that read-only
  classification now and apply the safe `REVOKE`s once the storefront dependency list
  lands, so we don’t break shop login/checkout.
