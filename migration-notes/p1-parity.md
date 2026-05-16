# P1 — Schema Parity Report

Source: `ckmnhgattkiziuykhczo` (KEEP subset only — 45 of 72 public tables)
Target: `ihnnipynpdtcbdfbpemq` (`mrbeanies-prod`)
Captured: 2026-05-15 (UTC)

## Headline scorecard

| Metric | Old (KEEP) | New (`mrbeanies-prod`) | Delta | Status |
|---|---:|---:|---:|---|
| Tables | 45 | 45 | 0 | ✅ |
| Tables with RLS enabled | 45 | 45 | 0 | ✅ |
| Functions (excluding cf_*/nl_*) | 39 | 39 | 0 | ✅ |
| Triggers on KEEP tables | 7 | 7 | 0 | ✅ |
| Event triggers (incl. system) | 7 | 7 | 0 | ✅ |
| RLS policies | 86 | 86 | 0 | ✅ |
| Indexes (incl. PK + UNIQUE) | 95 | 98 | **+3** | ✅ intentional |
| Foreign keys | 15 | 15 | 0 | ✅ |
| Sequences | 1 | 1 | 0 | ✅ |

## Column-count parity

All 45 tables have **identical column counts** to the source. Largest tables verified explicitly:
`mbg_client_intelligence` (41), `store_settings` (37), `orders` (33), `products` (18), `cms_pillar_cards` (15), `store_customers` (15), `customer_tiers` (13), `mbg_clients` (13), `cms_pages` (13).

`store_customers.phone_normalized` reproduced as `GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED` (the source's `pg_get_expr` output rendered it as a DEFAULT-with-column-reference, which Postgres rejects — corrected in chunk 2).

## The intentional +3 indexes

Per W0.4 mini-advisor, three foreign keys on KEEP tables were missing supporting indexes on the live project:

| Table | FK column | New index |
|---|---|---|
| `products` | `category_id` | `idx_products_category_id` — hot storefront read path |
| `payment_sessions` | `order_id` | `idx_payment_sessions_order_id` |
| `webauthn_challenges` | `customer_id` | `idx_webauthn_challenges_customer_id` |

All three are simple btree indexes; none rewrite query plans the dashboard or storefront depend on.

## What's NOT carried over (by design)

Carried no further into `mrbeanies-prod`:

- **Side-project tables:** all `cf_*` (Cardforge × 4), `nl_*` (Nicolife × 10), `customers` (legacy 0-row), `voice_transcriptions`, `prompt_library`, `chat_history`.
- **Empty CMS placeholders:** `cms_blog_posts`, `cms_inquiries`, `cms_media`, `cms_media_library`, `cms_pricing_plans`, `cms_products`.
- **Empty payment/discount placeholders the rebuild won't use:** `product_costs`, `discount_codes`, `payment_verifications`, `promo_codes`.
- **Side-project functions:** `cf_increment_views`, `cf_update_timestamp`, `nl_my_household_id`, `nl_update_timestamp` (4 of 43 old-project functions dropped).

## Known fidelity gaps to address in later phases

| Item | Why deferred | Resolution phase |
|---|---|---|
| `orders.payment_method DEFAULT 'cod'` | Replica of live default; the COD code-paths are still in edge functions / UI on the OLD stack | **P3** — strip COD everywhere together (skill §11.1 [2]) |
| `place_customer_order` falls back to `'gcash'` if payload omits payment method | Same as above | **P3** |
| Two overlapping policies on `orders` (`anon insert orders` + `orders_anon_insert_validated`) | Live project has them both; the unrestricted one shadows the validated one | **P3** — drop the unrestricted `anon insert orders` |
| Same overlap on `products` (`anon_manage_products` + `products_admin_all`) and `store_settings` | Live policy debt — `anon_manage_*` lets anon do everything | **P3** — keep only the `is_admin()`-gated versions |
| `cms_hero` defaults reference "Beauty AI Empire Builder" tagline | Source seed data; CMS rows themselves will be re-seeded with MBG content | **P5** — seed/migrate CMS content with MBG values |
| `mbg_orders.cost_of_sale` is `numeric(12,2)` and `discount_amount` is `numeric(12,2)` but their source values come back unquoted; verified types via pg_attribute match exactly | n/a | — |
| `webauthn_*` functions hardcode `rp_id = 'mr-greenies-store.netlify.app'` | Wrong domain — should be `newstorefrontmgb1234.netlify.app` today and the new storefront URL post-cutover | **P3** — fix to read from `store_settings` or env |

## Verification queries (re-runnable)

```sql
-- Single-call parity scorecard on either project
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind='r' AND n.nspname='public')                                AS tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind='r' AND n.nspname='public' AND c.relrowsecurity)           AS tables_with_rls,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f')                                AS functions,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND NOT t.tgisinternal)                           AS triggers,
  (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')      AS policies;
```

The new project is structurally ready to receive data in P5.
