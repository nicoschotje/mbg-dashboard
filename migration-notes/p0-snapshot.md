# P0 — Pre-flight Snapshot Record

**Project under backup:** `ckmnhgattkiziuykhczo` (nicoschotje's Project, region ap-northeast-1)
**Captured:** 2026-05-15 (UTC)

## What was captured automatically

The Supabase MCP does not expose a "Backup now" trigger, so a physical backup must be confirmed by the user via the dashboard. This file records the **logical snapshot** that we built ourselves as belt-and-braces:

| Artifact | Path |
|---|---|
| Exact row counts of every public table | `/outputs/p0-rowcounts.csv` |
| Edge function manifest (26 functions, dispositions) | `/outputs/p0-edgefns.md` |
| Netlify env inventory (both sites, secrets masked) | `/outputs/p0-env-inventory.md` |
| Mini-advisor categorised findings | `/outputs/p0-advisors.json` |
| Recovered storefront source | `/outputs/storefront-recovered/` *(in progress — see W0.2)* |

These together let us reconstruct a clean P0 baseline even if the physical backup is later lost.

## Physical backup — user action required

Open https://supabase.com/dashboard/project/ckmnhgattkiziuykhczo/database/backups/scheduled signed in as `johnloytdolina@gmail.com` and confirm one of:

- [ ] **Pro+ plan:** clicked "Backup now" → backup completed at `____-__-__ __:__ UTC`
- [ ] **Free plan:** confirmed most recent automatic daily backup at `____-__-__` is intact (no on-demand button needed; the daily backup is your snapshot)
- [ ] **PITR enabled:** Point-in-Time Recovery retention confirms it covers from `____-__-__ __:__ UTC` onward

Fill in one of the above and we treat P0 as fully snapshotted.

## Why this matters

- Anything in P1–P5 reads from this DB. If something corrupts the source mid-rebuild, this is the rollback point.
- After P5 (data migration to `mrbeanies-prod`) succeeds and is stable for 30 days, this same snapshot is what we'd restore from if cutover had to be reversed.

## Notes from snapshot

- DB version: Postgres 17.6.1.084
- Row counts captured for **72 tables in `public`**
- Active MBG-business row volume (the data we will migrate):
  - `mbg_orders` 1,236 · `mbg_clients` 410 · `orders` 278 · `mbg_order_enrichments` 278 · `mbg_client_intelligence` 208 · `products` 78 · `store_customers` 20 · `customer_sessions` 200 · `auth_audit_log` 314 · `activity_log` 139
- Side-project rows that do **NOT** migrate: 1 (`cf_cards`); all `nl_*` tables empty; all AI/voice tables empty.
