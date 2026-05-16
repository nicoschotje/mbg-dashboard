# P3.7 — Edge function deletions on the OLD project

**Project:** `ckmnhgattkiziuykhczo` (LIVE — "nicoschotje's Project")
**Reason:** These functions are unused (DROP-DUP, DROP-SIDE, DROP-MIG, VERIFY=no-callers) and should be removed before cutover so they don't clutter the manifest or expose unauthenticated endpoints.

## Why I can't delete them via MCP

The Supabase MCP exposes `deploy_edge_function` but not `delete_edge_function`. Edge function deletion is a UI-only operation today.

## The 13 functions to delete

Open https://supabase.com/dashboard/project/ckmnhgattkiziuykhczo/functions, click each name → "Manage" → "Delete function" → confirm.

### Side-project leftovers (8)

These belong to projects unrelated to MBG (Cardforge, Nicolife, AI proxy, PrimeLabs PH).

- [ ] `cf-record-view`
- [ ] `cf-get-card`
- [ ] `cf-get-views`
- [ ] `cf-update-card`
- [ ] `cf-generate-vcard`
- [ ] `cf-generate-pass`
- [ ] `nicolife-auth`
- [ ] `ai-proxy`
- [ ] `create-payment` (PrimeLabs PH + Xendit — see [p2-edgefns.md](./p2-edgefns.md) for the catch)

### Duplicate / migration / vestigial (4)

- [ ] `notify-costomer` (typo duplicate of `notify-customer` — grep confirms zero callers)
- [ ] `validate-cutover` (one-shot migration tool from a previous attempt)
- [ ] `save-product` (zero callers in recovered storefront source — verified P3.7)
- [ ] `save-settings` (zero callers in recovered storefront source — verified P3.7)

## What happens if you don't delete them

Nothing breaks — they just sit there as unused endpoints. The downsides are:
- They're publicly invokable (CORS `*`, verify_jwt mostly false) — minor attack surface
- `create-payment` writes to the `customers` legacy table if invoked, creating phantom rows
- `notify-costomer` could theoretically be triggered by mistake (typo)

So this is hygiene, not blocking. Do it whenever convenient before P7 cutover.

## Verification after deletion

```sql
-- Should return only the 12 functions ported to mrbeanies-prod (plus place-order, notify-customer):
SELECT slug FROM (
  SELECT 'place-order' AS slug UNION ALL SELECT 'notify-customer' UNION ALL
  SELECT 'update-order' UNION ALL SELECT 'delivery-quote' UNION ALL
  SELECT 'upload-receipt' UNION ALL SELECT 'upload-product-image' UNION ALL
  SELECT 'upload-qr-image' UNION ALL SELECT 'telegram-webhook' UNION ALL
  SELECT 'setup-telegram-webhook' UNION ALL SELECT 'telegram-intelligence-alerts' UNION ALL
  SELECT 'compute-client-intelligence' UNION ALL SELECT 'import-sheets-data'
) ORDER BY 1;
```

Or just `mcp__supabase list_edge_functions` after deletion and compare to the expected 12.
