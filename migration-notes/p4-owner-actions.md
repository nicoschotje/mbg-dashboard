# P4 — Owner-side actions to bring up the parallel new stack

The two new Netlify sites exist and are correctly configured with env vars. They're empty (no deploy yet). Three short steps from you bring up the parallel stack — old site stays running unchanged on the live Supabase.

## What's already done

| Item | State |
|---|---|
| `mbg-storefront-prod` Netlify site | ✅ created, env vars set |
| `mbg-dashboard-prod` Netlify site | ✅ created, env vars set |
| `storefront/js/core/config.js` swap to new Supabase | ✅ committed on `p4/cutover` branch |
| `mrbeanies-prod` Supabase project | ✅ healthy, schema applied, edge fns deployed |

| Site | URL (once deployed) |
|---|---|
| Storefront | https://mbg-storefront-prod.netlify.app |
| Dashboard | https://mbg-dashboard-prod.netlify.app |

## What needs your hands (≈ 5 minutes total)

### Step 1 — Push the P4 commit to GitHub

Same pattern as before:

```bash
cd ~/code/beauty-ai-empire-builder
git fetch "/Users/grandpanico/Library/Application Support/Claude/local-agent-mode-sessions/445500b9-9153-4b6d-8ebd-73280e6e7c4f/877beb95-91cb-4274-9588-74f143d75329/local_e6218f22-a2e3-42be-9233-313d49e8e591/outputs/p4-cutover.bundle" p4/cutover:p4/cutover
git push -u origin p4/cutover
```

This puts three commits (recover → P3 → P4) into a single PR you can review and merge to `main`.

### Step 2 — Deploy the storefront to `mbg-storefront-prod` (drag-and-drop)

The storefront is a manual-deploy site (no git connection), same pattern as the old `newstorefrontmgb1234`.

1. Open https://app.netlify.com/projects/mbg-storefront-prod/deploys
2. Drag `/outputs/mbg-storefront-deploy.zip` (40 KB) into the drag-and-drop box at the bottom of the page.
3. Wait ~10 seconds for the deploy to finish.
4. Click the published URL — should be `https://mbg-storefront-prod.netlify.app`.

Expected: storefront loads, you see the empty PIN-login screen. Trying to log in fails (no customers in the new DB yet — that's correct for now).

### Step 3 — Git-connect `mbg-dashboard-prod`

The dashboard auto-deploys from git on the old setup. To do the same:

1. Open https://app.netlify.com/projects/mbg-dashboard-prod/configuration/deploys
2. Click **"Link repository"** → GitHub → pick `nicoschotje/beauty-ai-empire-builder`.
3. When prompted for build settings:
   - **Branch to deploy:** `main`
   - **Base directory:** (leave empty)
   - **Build command:** (leave empty)
   - **Publish directory:** `dashboard-v2`
4. Save. It will deploy from `main` automatically.
5. After your push from Step 1 lands on `main`, redeploy triggers automatically.

Expected: dashboard loads at `https://mbg-dashboard-prod.netlify.app`, shows the PIN gate. Owner-PIN login will work because `dashboard_settings.OWNER_PIN_HASH` exists on `mrbeanies-prod` once we seed it (P5).

## Smoke test — verify the parallel stack is reading the new project

Once both sites are deployed, in a private/incognito window:

| Test | Storefront URL | Expected |
|---|---|---|
| 1 | https://mbg-storefront-prod.netlify.app | Loads, shows MBG login screen with phone+PIN form |
| 2 | DevTools → Network → filter for `supabase.co` | Requests go to `ihnnipynpdtcbdfbpemq.supabase.co` ✅ NOT `ckmnhgattkiziuykhczo` |
| 3 | DevTools → Console | No CSP / 404 errors |
| 4 | Try a PIN login with any number | Fails with "no customer" — correct, DB is empty |

For the dashboard:

| Test | Dashboard URL | Expected |
|---|---|---|
| 1 | https://mbg-dashboard-prod.netlify.app | PIN gate appears |
| 2 | DevTools → Network → filter for `supabase.co` | Requests go to `ihnnipynpdtcbdfbpemq.supabase.co` |
| 3 | DevTools → Console | No errors; Realtime connects |

If any of those fail, ping me and I'll dig in.

## ⚠ One thing the dashboard needs you to be aware of

Per skill §5.1 / G4, the dashboard hardcodes its Supabase anon key in two places:
- `dashboard-v2/index.html` → `window.__MBG_SUPA_KEY__`
- `dashboard-v2/js/core/supabase.js` → `SUPA_URL`

These currently point at the live `ckmnhgattkiziuykhczo`. If we redeploy `mbg-dashboard-prod` from current `main`, **the dashboard will still talk to the OLD Supabase** because the hardcoded values win over env vars. We have two options for the new dashboard site to point at `mrbeanies-prod`:

1. Commit the URL+key swap to a P4.7 commit (alongside the storefront swap) — clean, gits all changes together.
2. Set the Netlify build pipeline to do a sed-substitute at build time (more involved).

I'd lean (1). Reply **"swap dashboard too"** and I'll add that commit before the gate closes. Otherwise the new dashboard site will read from the live DB until cutover (which is fine for parallel testing because both DBs co-exist).

## What's left in P4

After your three steps above, P4 is done. The parallel stack will be live at `mbg-storefront-prod.netlify.app` + `mbg-dashboard-prod.netlify.app`, reading from `mrbeanies-prod` (empty).

P5 is data migration — populate the new project with the live data. The new storefront/dashboard then become functional and ready for cutover.
