# W0.2 — Storefront Recovery Push Instructions

Branch: `recover/storefront`
Commit: recovers 16 files (180 KB total) into `storefront/` and fixes the indentation-bloated `products.js`.

## Option A — Apply the git bundle (recommended)

```bash
cd ~/code/beauty-ai-empire-builder   # adjust to wherever you cloned it
git fetch "/Users/grandpanico/Library/Application Support/Claude/local-agent-mode-sessions/445500b9-9153-4b6d-8ebd-73280e6e7c4f/877beb95-91cb-4274-9588-74f143d75329/local_e6218f22-a2e3-42be-9233-313d49e8e591/outputs/recover-storefront.bundle" recover/storefront:recover/storefront
git push -u origin recover/storefront
```

Then open the compare URL in your browser:
https://github.com/nicoschotje/beauty-ai-empire-builder/compare/main...recover/storefront

## Option B — Apply the patch instead

```bash
cd ~/code/beauty-ai-empire-builder
git checkout main && git pull
git checkout -b recover/storefront
git am < "/Users/grandpanico/Library/Application Support/Claude/local-agent-mode-sessions/445500b9-9153-4b6d-8ebd-73280e6e7c4f/877beb95-91cb-4274-9588-74f143d75329/local_e6218f22-a2e3-42be-9233-313d49e8e591/outputs/recover-storefront.patch"
git push -u origin recover/storefront
```

## What changed

- **15 new files** under `storefront/` (HTML, CSS, JS modules, manifest)
- **1 rewritten file**: `storefront/js/modules/products.js` (replaces 128 KB indentation-corrupted version with the clean 9.6 KB live version — content is functionally identical, just deflated)

No production behaviour changes. Pure source-recovery commit. Open as a PR onto `main` and merge.

## P3 will land its changes as new commits on top of this branch (or main after merge).
