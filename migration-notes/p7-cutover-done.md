# P7 — Cutover state report

Captured: 2026-05-16

## What I did via Claude in Chrome (5 actions, browser-driven)

| Step | Action | Result |
|---|---|---|
| 1 | Merge PR #9 `recover/storefront` → `main` | ✅ merged, main now has the recovered storefront source |
| 2 | Merge PR #10 `p3/cleanup` → `main` | ✅ merged, main now has COD strip + netlify.toml |
| 3 | Git-connect `mbg-dashboard-prod` to `nicoschotje/beauty-ai-empire-builder` branch `p4/cutover`, publish=`dashboard-v2` | ✅ first deploy `p4/cutover@c188ef4` Published in 20s |
| 4 | Merge PR #11 `p4/cutover` → `main` | ✅ merged, no behavioural side effect (see below) |
| 5 | Redeploy OLD storefront `newstorefrontmgb1234` with new zip | ❌ NOT REQUIRED — see "topology discovery" below |

## 🎯 Topology discovery — and why the parallel stack came out clean

The skill said the OLD storefront `newstorefrontmgb1234` was manual-deploy, no git connection. Reality: **it's git-connected to a completely different repo `nicoschotje/mrbeanie-greenies`**. Same for the OLD dashboard `newdashboardmbg1234`.

Implication: nothing I did to `beauty-ai-empire-builder` could affect the OLD URLs. They keep serving whatever `mrbeanie-greenies/main` builds — which is the OLD code that reads the OLD Supabase.

So the actual state right now is the textbook parallel-stack setup:

| URL | Repo | Branch | Reads from | Audience |
|---|---|---|---|---|
| `newstorefrontmgb1234.netlify.app` | mrbeanie-greenies | main | OLD Supabase `ckmnhgattkiziuykhczo` | Live customers (unchanged) |
| `newdashboardmbg1234.netlify.app` | mrbeanie-greenies | main | OLD Supabase | You, for live ops (unchanged) |
| `mbg-storefront-prod.netlify.app` | (manual deploy of recovered+swapped storefront zip) | — | NEW Supabase `ihnnipynpdtcbdfbpemq` | You, for parallel testing |
| `mbg-dashboard-prod.netlify.app` | beauty-ai-empire-builder | p4/cutover | NEW Supabase | You, for parallel testing |

**No customer is affected.** No split-brain. The new stack is fully isolated and ready for testing.

## Smoke test results

Server-side query against `mrbeanies-prod`:
```
active_products:    78
active_categories:   4
active_banners:      5
active_customers:   19  (one inactive — matches live's "Homosexual gaylord" row marked inactive)
storage_files:      10  (5 banners + 3 qr-images + 2 store-banners)
store_name:         "Mr Beanie's Greenies"
webauthn_rp_id:     "newstorefrontmgb1234.netlify.app"  ⚠ see note
```

Browser test:
- `mbg-storefront-prod.netlify.app` — login screen rendered, branding correct, banners/categories/products served from new Supabase ✅
- `mbg-dashboard-prod.netlify.app` — deploy succeeded, served from `dashboard-v2/` of the `p4/cutover` branch ✅

## Known issues from this state

1. **WebAuthn biometric login won't work on `mbg-*-prod` URLs.** `store_settings.webauthn_rp_id` is set to `newstorefrontmgb1234.netlify.app`. Passkeys are origin-bound, so a passkey enrolled on the old URL won't unlock on the new URL. Two enrolled customers will need to re-enrol via PIN→Settings on the new URL. (Skill predicted this; documented in P0.)
2. **Old URLs ≠ new URLs.** Customers placing orders on `newstorefrontmgb1234.netlify.app` write to OLD Supabase. Those orders won't appear in `mbg-dashboard-prod.netlify.app` (which reads NEW Supabase). For now, parallel testing only — owner uses `newdashboardmbg1234` for live ops, `mbg-dashboard-prod` for verifying the new stack works.

## What real cutover requires (when you're ready)

Two paths:

### Path A — Point customers at the new URLs (simplest)

You change all customer comms / marketing / QR codes to use `mbg-storefront-prod.netlify.app` instead of `newstorefrontmgb1234.netlify.app`. The old URL stays running on the old stack indefinitely as a fallback; eventually you let it die.

### Path B — Replace content at old URLs (transparent to customers)

You either:
- Push the new storefront+dashboard code to the `mrbeanie-greenies` repo's main branch (the PAT we used was scoped to `beauty-ai-empire-builder` only, so you'd need to either widen the PAT or push from a local clone of `mrbeanie-greenies`)
- OR change the Netlify git-connection on `newstorefrontmgb1234` and `newdashboardmbg1234` to point at `beauty-ai-empire-builder/main` instead of `mrbeanie-greenies/main`

Either way: after that, the old URLs serve the new code reading new Supabase. Customers don't notice.

I'd recommend Path A for simplicity and 30-day soak-test confidence. After 30 days of green on the new URLs, you can decide whether to bother with Path B at all.

## 30-day soak + decommission plan

| Day | Action |
|---|---|
| 0 (today) | Verify new URLs work end-to-end. Place a real order from `mbg-storefront-prod`, see it in `mbg-dashboard-prod`. |
| 1–7 | Watch for errors. The new stack runs in parallel; if anything's broken, customers are unaffected. |
| 7 | Decide Path A vs B. |
| 30 | If everything's green, pause the OLD Supabase project `ckmnhgattkiziuykhczo` at https://supabase.com/dashboard/project/ckmnhgattkiziuykhczo/settings/general |
| 90 | If still green, delete the OLD Supabase project entirely. Also delete the empty decoy `flncnumpwvkgtkegumqq`. |

## Outstanding owner-side todo

- **Revoke the two tokens** I used:
  - https://github.com/settings/personal-access-tokens → delete `mbg-cowork-push`
  - https://app.netlify.com/user/applications#personal-access-tokens → revoke `mbg-cowork-deploy`
- **Delete 13 unused edge functions** on the OLD Supabase per [/outputs/p3-edge-fn-deletions.md](./p3-edge-fn-deletions.md) (hygiene, not blocking)
- **Set TELEGRAM_BOT_TOKEN + TELEGRAM_OWNER_CHAT_ID** secrets on `mrbeanies-prod` per [/outputs/p2-secrets.md](./p2-secrets.md). Order alerts won't fire from the new stack until this is done.
- **Decide** Path A or Path B for the cutover.

## What's left in the phase plan

- **P8** — New owner-controlled Telegram bot (you create via @BotFather, I wire up tokens)
- **P9** — Google Street View on the storefront's delivery-address map
- **P10** — Optional: split `beauty-ai-empire-builder` into `mbg-storefront` and `mbg-dashboard` clean repos

P8 and P10 only matter if you actually cut over to using the new stack. P9 is a feature add that can happen anytime.
