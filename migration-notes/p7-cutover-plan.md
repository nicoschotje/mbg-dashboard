# P7 — Cutover & 30-day pause plan

## What the browser agent's 5 tasks accomplish

| After… | What flips | Old URL behavior | New URL behavior |
|---|---|---|---|
| Tasks 1–2 (merge recover + P3) | nothing user-visible | unchanged | unchanged |
| Task 3 (git-connect new dashboard) | nothing for live customers | unchanged | `mbg-dashboard-prod.netlify.app` becomes live (parallel-stack test target) |
| Task 4 (merge p4/cutover → main) | **OLD dashboard switches to NEW Supabase** | `newdashboardmbg1234.netlify.app` → reads `mrbeanies-prod` | same |
| Task 5 (redeploy old storefront) | **OLD storefront switches to NEW Supabase** | `newstorefrontmgb1234.netlify.app` → reads `mrbeanies-prod` | same |

After Task 5, **both old URLs and both new URLs all read from `mrbeanies-prod`**. Customers don't see a URL change. The old Supabase `ckmnhgattkiziuykhczo` is no longer reachable from any live site — it just sits, untouched, until pause.

## Why the parallel topology was preserved through Tasks 1–3

The smart bit is that during Tasks 1–3, the OLD stack still uses the OLD Supabase. Task 4 is the single moment of cutover. If anything breaks at Task 4, only the OLD dashboard is affected (rollback = revert the merge in GitHub UI). If Task 5 breaks, only the OLD storefront is affected (rollback = redeploy the previous Netlify deploy from the dashboard).

## What can go wrong + how to recover

| Symptom | Cause | Recovery |
|---|---|---|
| OLD dashboard 404s or blank-screens after Task 4 | new code has a bug we didn't catch | Netlify → newdashboardmbg1234 → Deploys → click previous deploy → "Publish deploy" |
| Customer login fails on `newstorefrontmgb1234` after Task 5 | new project's `customer_sessions` is empty (we didn't migrate it) | Expected — customer re-logs in via PIN. Token from old project no longer matches a session row on new project. |
| Telegram alerts stop | `TELEGRAM_BOT_TOKEN` env not set on `mrbeanies-prod` edge functions | Set per `/outputs/p2-secrets.md`. Owner action. |
| Product images broken | Owner hasn't re-uploaded yet | Expected — owner uploads via dashboard → Products → edit → upload image |

## The 30-day pause + delete plan for the old project

**Day 0** (today, after Task 5): Both old URLs serve new Supabase. Watch for errors for the first 24h.

**Day 7**: Smoke test — log in as a real customer via the old URL, place a test order, verify it lands in `mrbeanies-prod`. If green, proceed. If anything is off, debug, push fixes via PR merge.

**Day 30**: Pause the old project.
```
Open https://supabase.com/dashboard/project/ckmnhgattkiziuykhczo/settings/general
→ scroll to "Pause project" → confirm
```
Pausing is reversible — you can restore within 90 days if needed.

**Day 90** (or whenever fully confident): Delete the old project.
```
Same Project Settings page → "Delete project" → type the project ref to confirm.
```
Also delete the empty decoy `flncnumpwvkgtkegumqq` while you're there.

## What's NOT part of P7 (deferred to P8–P10)

| Phase | Scope |
|---|---|
| P8 | New owner-controlled Telegram bot. Owner runs @BotFather, sets `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OWNER_CHAT_ID` on `mrbeanies-prod`. Re-invokes `setup-telegram-webhook`. |
| P9 | Google Street View on the storefront's delivery-address map. Code edit to `checkout.js`, new `GOOGLE_MAPS_API_KEY` env (referrer-restricted). |
| P10 | Repo split — `mbg-storefront` and `mbg-dashboard` as separate repos. Beauty AI Empire Builder root files stay in original repo. |

## Outputs from earlier phases relevant to P7

- [p5-parity.md](./p5-parity.md) — what data exists on `mrbeanies-prod`
- [p6-parity.md](./p6-parity.md) — what storage files exist
- [p4-owner-actions.md](./p4-owner-actions.md) — original owner-side playbook (now mostly automated by the browser agent)
- [p2-secrets.md](./p2-secrets.md) — Telegram secrets still pending
