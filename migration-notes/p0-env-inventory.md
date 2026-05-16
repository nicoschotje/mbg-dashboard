# P0 — Netlify Environment Variable Inventory

Captured: 2026-05-15 (UTC). Secret values redacted. **Anon JWTs are public-by-design and shown unredacted**; service role keys and admin secrets are masked.

---

## Storefront — `newstorefrontmgb1234` (`d559eb05-0503-4cb8-acfa-56732c39e806`)

| Key | Contexts | is_secret | Value (excerpt) |
|---|---|---|---|
| `SUPABASE_URL` | dev, branch-deploy, deploy-preview, production | no | `https://ckmnhgattkiziuykhczo.supabase.co` ✅ correct |
| `SUPABASE_ANON_KEY` | dev, branch-deploy, deploy-preview, production | no | `eyJ…l2ErPyJe6q2sI4UpNtRp9qRfeVkfdrHSOdkensj83IA` — JWT for ref=ckmnhgattkiziuykhczo, role=anon, exp=2088 ✅ correct |
| `SUPABASE_SERVICE_ROLE_KEY` | all | no | 🔴 **SECURITY ISSUE** — service-role JWT (ref=flncnumpwvkgtkegumqq i.e. the EMPTY decoy) set on the storefront. Must NEVER live on a public site. Delete in P3 cleanup. |

### Notes
- Two `SUPABASE_*` keys agree on the correct project (`ckmnhgattkiziuykhczo`).
- The rogue `SUPABASE_SERVICE_ROLE_KEY` references the empty decoy `flncnumpwvkgtkegumqq` — even though it's not the live project, it is still a service-role JWT and must be deleted (it would happily mutate the decoy DB if anyone reached it).
- All four contexts (dev, branch-deploy, deploy-preview, production) hold the same anon key. Acceptable; on rebuild use distinct preview vs production where it adds safety.

---

## Dashboard — `newdashboardmbg1234` (`f07a0196-822a-4807-baaa-73ff5659c5f9`)

| Key | Contexts | is_secret | Value (excerpt) |
|---|---|---|---|
| `SUPABASE_URL` | dev, branch-deploy, deploy-preview, production, dev-server | yes | `https://flncnumpwvkgtkegumqq.supabase.co` 🔴 **POINTS AT EMPTY DECOY** (skill G1) |
| `SUPABASE_ANON_KEY` | dev, branch-deploy, deploy-preview, production, dev-server | yes | `eyJ…mjL3r0ssbbaGKA4vLUqmctKEIf2xBvaBSTkCoyRwzfo` — JWT for ref=flncnumpwvkgtkegumqq, role=anon 🔴 wrong project |
| `SUPABASE_SERVICE_ROLE_KEY` | dev, branch-deploy, deploy-preview, production, dev-server | yes | 🔴 service-role JWT for ref=flncnumpwvkgtkegumqq. Same: should not be on a static site. |

### Notes
- All three keys point at the **empty decoy** project, not the live one. The dashboard renders correctly because `dashboard-v2/index.html` hardcodes `window.__MBG_SUPA_KEY__` and `js/core/supabase.js` hardcodes `SUPA_URL` — the env vars are ignored at runtime. (Skill §5.1, G4.)
- This is harmless today but it means: on rebuild, **wire env vars correctly AND remove the hardcoded values in code** so the two sources of truth converge.
- All `is_secret: true` here — meaning the values are masked in the Netlify UI for log output. Best practice. Keep on rebuild.

---

## Findings & required actions before P4

1. **DELETE** `SUPABASE_SERVICE_ROLE_KEY` from the storefront site entirely.
2. **REPLACE** all three keys on the dashboard site with the new `mrbeanies-prod` values.
3. **STOP** hardcoding the anon key in `dashboard-v2/index.html` (window.__MBG_SUPA_KEY__) and `js/core/supabase.js` — read from Netlify env at build instead (acceptable since dashboard has a Netlify build pipeline, unlike the storefront).
4. **CHECK** whether anything on the storefront actually consumes `SUPABASE_SERVICE_ROLE_KEY` (it shouldn't — but grep the storefront recovery once we have it).

## Canonical env-var matrix for the rebuild (target state)

| Var | mbg-storefront-prod | mbg-dashboard-prod | Notes |
|---|---|---|---|
| `SUPABASE_URL` | ✅ public | ✅ public | new project URL |
| `SUPABASE_ANON_KEY` | ✅ public | ✅ public | anon JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ never | ❌ never | edge functions only, set on Supabase |
| `GOOGLE_MAPS_API_KEY` | ✅ public (referrer-restricted) | — | Phase 9 |
| `TELEGRAM_BOT_TOKEN` | ❌ | ❌ | edge functions only |
| `TELEGRAM_OWNER_CHAT_ID` | ❌ | ❌ | edge functions only |
