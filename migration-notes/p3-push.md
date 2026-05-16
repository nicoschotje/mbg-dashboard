# P3 — Push Instructions

Branch: `p3/cleanup` (sits atop `recover/storefront`, which sits atop `main`)

Two commits in the bundle:
1. `1b0a1aa` — recover: storefront source from live Netlify (P0 W0.2)
2. `3fcaf47` — P3: storefront COD strip + repo netlify.toml

## Option A — Apply the bundle (recommended)

```bash
cd ~/code/beauty-ai-empire-builder   # wherever you cloned it
git fetch "/Users/grandpanico/Library/Application Support/Claude/local-agent-mode-sessions/445500b9-9153-4b6d-8ebd-73280e6e7c4f/877beb95-91cb-4274-9588-74f143d75329/local_e6218f22-a2e3-42be-9233-313d49e8e591/outputs/p3-cleanup.bundle" p3/cleanup:p3/cleanup
git push -u origin p3/cleanup
```

Open the compare URL:
https://github.com/nicoschotje/beauty-ai-empire-builder/compare/main...p3/cleanup

You can review both commits and merge as a single PR titled "P0 recovery + P3 cleanup".

## Option B — Apply patches one at a time

If you'd rather see them separately:

```bash
cd ~/code/beauty-ai-empire-builder && git checkout main && git pull
git checkout -b recover/storefront
git am < "/Users/grandpanico/Library/Application Support/Claude/local-agent-mode-sessions/445500b9-9153-4b6d-8ebd-73280e6e7c4f/877beb95-91cb-4274-9588-74f143d75329/local_e6218f22-a2e3-42be-9233-313d49e8e591/outputs/recover-storefront.patch"
git checkout -b p3/cleanup
git am < "/Users/grandpanico/Library/Application Support/Claude/local-agent-mode-sessions/445500b9-9153-4b6d-8ebd-73280e6e7c4f/877beb95-91cb-4274-9588-74f143d75329/local_e6218f22-a2e3-42be-9233-313d49e8e591/outputs/p3-cleanup.patch"
git push -u origin recover/storefront
git push -u origin p3/cleanup
```

## What's in the P3 commit

| File | Change |
|---|---|
| `storefront/js/core/config.js` | Removed 1-line `{id:'cod', …}` entry from `PAYMENT_METHODS` array |
| `storefront/js/modules/checkout.js` | Removed the `if (method === 'cod') { … return; }` block in `renderPayInfo()` |
| `netlify.toml` | New file at repo root — security headers + SPA fallback + cache rules |

## What was done outside git (cannot be patched into the repo)

These ran as live operations on the Supabase projects:

| What | Project | Migration name |
|---|---|---|
| COD default flip + NOT VALID check + `webauthn_rp_id` column | `ihnnipynpdtcbdfbpemq` | `p3_01_cod_removal_and_webauthn_rp_id` |
| COD default flip + NOT VALID check + `webauthn_rp_id` column | `ckmnhgattkiziuykhczo` | `p3_01_cod_removal_and_webauthn_rp_id` |
| RLS policy de-duplication | `ihnnipynpdtcbdfbpemq` only | `p3_02_rls_dedup` |
| `webauthn_*_challenge` rp_id from `store_settings` | `ihnnipynpdtcbdfbpemq` only | `p3_03_webauthn_rp_id_from_settings` |
| `update-order` v2 (env var + is_admin gate) | `ihnnipynpdtcbdfbpemq` only | (edge function redeploy) |

Live project's RLS + webauthn RPC + update-order **deliberately not touched** — the live ckmnhgattkiziuykhczo gets paused at P7 cutover. Updating it now would risk breaking the dashboard before the new stack is ready.
