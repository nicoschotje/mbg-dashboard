# P0 — Edge Function Manifest

Project: `ckmnhgattkiziuykhczo` (nicoschotje's Project)
Captured: 2026-05-15 (UTC)
Total active functions: **26**

Disposition legend (per project skill §4.4 + §11.1):
- **KEEP** — port to `mrbeanies-prod` cleaned
- **CLEAN** — port but with code changes (drop COD branch, minimal Telegram messages, swap hardcoded URLs)
- **VERIFY** — confirm nothing still calls it before porting
- **DROP-DUP** — typo duplicate of another function
- **DROP-SIDE** — belongs to Cardforge / Nicolife / AI-proxy, not MBG
- **DROP-MIG** — one-shot migration tool, not part of steady state

| Slug | verify_jwt | Last updated (epoch ms) | Disposition | Notes |
|---|---|---|---|---|
| place-order | ✅ true | 1776313310629 | **CLEAN** | strip COD branch; minimal owner alert "🔔 New order received from {name}"; replace hardcoded `mrbeaniesdashboard.netlify.app` link |
| update-order | ❌ false | 1772844213758 | KEEP | check why JWT off — should be gated by x-admin-secret |
| notify-customer | ❌ false | 1774833610394 | **CLEAN** | minimal status message only |
| notify-costomer | ✅ true | 1772878529246 | **DROP-DUP** | typo duplicate of notify-customer — verify zero callers before deletion |
| delivery-quote | ❌ false | 1773056845306 | KEEP | |
| upload-receipt | ❌ false | 1772870584006 | KEEP | |
| upload-product-image | ❌ false | 1772933947828 | KEEP | |
| upload-qr-image | ❌ false | 1772944898575 | KEEP | |
| save-product | ❌ false | 1772846098654 | VERIFY | dashboard writes table directly — may be vestigial |
| save-settings | ❌ false | 1772844226441 | VERIFY | same — may be vestigial |
| create-payment | ❌ false | 1777788107878 | KEEP | PayMongo / payment processor entry point |
| telegram-webhook | ❌ false | 1774836295384 | KEEP | rotate bot token in P8 |
| setup-telegram-webhook | ❌ false | 1774833698912 | KEEP | one-shot setup; keep available |
| telegram-intelligence-alerts | ❌ false | 1775916396169 | KEEP | |
| compute-client-intelligence | ❌ false | 1775917824387 | KEEP | |
| import-sheets-data | ❌ false | 1775918303625 | KEEP | |
| ai-proxy | ✅ true | 1777778381227 | **DROP-SIDE** | unrelated AI proxy |
| nicolife-auth | ❌ false | 1775094234593 | **DROP-SIDE** | Nicolife |
| cf-record-view | ❌ false | 1775962823218 | **DROP-SIDE** | Cardforge |
| cf-get-card | ❌ false | 1775962834065 | **DROP-SIDE** | Cardforge |
| cf-get-views | ❌ false | 1775962847733 | **DROP-SIDE** | Cardforge |
| cf-update-card | ❌ false | 1775962868339 | **DROP-SIDE** | Cardforge |
| cf-generate-vcard | ❌ false | 1775962883937 | **DROP-SIDE** | Cardforge |
| cf-generate-pass | ❌ false | 1775963208573 | **DROP-SIDE** | Cardforge |
| validate-cutover | ❌ false | 1775916512116 | **DROP-MIG** | one-shot migration guard from a previous attempt |

## Summary

- **Port to new project (KEEP + CLEAN):** 14 functions
- **Verify first (potentially vestigial):** 2 functions
- **Drop (side-projects + dup + migration tool):** 10 functions

## Verification commands

```bash
# Anywhere notify-costomer is called from the codebase:
grep -RIn 'notify-costomer' .

# Anywhere save-product / save-settings are still invoked:
grep -RIn -E '(functions/v1/(save-product|save-settings))' .
```

## Caveats

- `verify_jwt: false` on every cf-*/nl-* and most KEEP functions means anon callers can invoke them — gating must be done inside the function body (header check on x-admin-secret, or origin checks). Audit each on port.
- `place-order` has `verify_jwt: true` — that's the only function consuming the customer's JWT; the rest validate at the body level. Keep that behaviour on rebuild.
