# P2 — Edge Function Deployment Parity

Captured: 2026-05-15 (UTC)

## Live deployed list on `mrbeanies-prod` (verified via list_edge_functions)

```
slug                              verify_jwt   version
─────────────────────────────────────────────────────
place-order                       true         1   (CLEAN)
notify-customer                   false        1   (CLEAN)
update-order                      false        1
delivery-quote                    false        1
upload-receipt                    false        1
upload-product-image              false        1
upload-qr-image                   false        1
telegram-webhook                  false        1
setup-telegram-webhook            false        1
telegram-intelligence-alerts      false        1
compute-client-intelligence       false        1
import-sheets-data                false        1
─────────────────────────────────────────────────────
Total: 12 ACTIVE
```

## verify_jwt parity vs source

| Function | Old | New | Match |
|---|:---:|:---:|:---:|
| place-order | true | true | ✅ |
| notify-customer | false | false | ✅ |
| update-order | false | false | ✅ |
| delivery-quote | false | false | ✅ |
| upload-receipt | false | false | ✅ |
| upload-product-image | false | false | ✅ |
| upload-qr-image | false | false | ✅ |
| telegram-webhook | false | false | ✅ |
| setup-telegram-webhook | false | false | ✅ |
| telegram-intelligence-alerts | false | false | ✅ |
| compute-client-intelligence | false | false | ✅ |
| import-sheets-data | false | false | ✅ |

All 12 functions have `verify_jwt` matching the source.

## Function URLs (for env-var configuration in P4)

Base URL pattern: `https://ihnnipynpdtcbdfbpemq.supabase.co/functions/v1/<slug>`

For example:
- `https://ihnnipynpdtcbdfbpemq.supabase.co/functions/v1/place-order`
- `https://ihnnipynpdtcbdfbpemq.supabase.co/functions/v1/notify-customer`
- `https://ihnnipynpdtcbdfbpemq.supabase.co/functions/v1/telegram-webhook` ← register this with @BotFather via `setup-telegram-webhook` once token is set

## Status

P2 ✅ complete. New project has the full MBG edge-function surface area (minus the one wrong-project function I caught and dropped). Secrets to set + storefront recovery for P3 are the only outstanding blockers before payment + customer flows can be end-to-end tested.
