# P0 — Push Instructions

The cowork sandbox can read GitHub anonymously but can't authenticate to push (no PAT available here, and `api.github.com` is proxy-blocked anyway). You need to run one of the options below on your Mac to push the baseline PR.

I've prepared two artifacts in your outputs folder. **Use the bundle (Option A) — it's the cleanest path.**

## Option A — Apply the git bundle (recommended)

```bash
# 1. Clone (or cd into) the repo locally
cd ~/code   # or wherever you keep your repos
git clone https://github.com/nicoschotje/beauty-ai-empire-builder.git
cd beauty-ai-empire-builder

# 2. Pull the prepared branch from the bundle
git fetch "/Users/grandpanico/Library/Application Support/Claude/local-agent-mode-sessions/445500b9-9153-4b6d-8ebd-73280e6e7c4f/877beb95-91cb-4274-9588-74f143d75329/local_e6218f22-a2e3-42be-9233-313d49e8e591/outputs/p0-baseline.bundle" p0/baseline:p0/baseline

# 3. Push the branch to GitHub
git push -u origin p0/baseline

# 4. Open the PR in your browser
gh pr create --base main --head p0/baseline \
  --title "P0: baseline — pre-flight snapshot before clean rebuild" \
  --body "See baseline/ for full context. Docs-only PR anchoring P0 in repo history."
# OR open the compare URL Netlify will give you after the push:
# https://github.com/nicoschotje/beauty-ai-empire-builder/compare/main...p0/baseline
```

## Option B — Apply the patch

```bash
cd ~/code/beauty-ai-empire-builder
git checkout main && git pull
git checkout -b p0/baseline
git am < "/Users/grandpanico/Library/Application Support/Claude/local-agent-mode-sessions/445500b9-9153-4b6d-8ebd-73280e6e7c4f/877beb95-91cb-4274-9588-74f143d75329/local_e6218f22-a2e3-42be-9233-313d49e8e591/outputs/p0-baseline.patch"
git push -u origin p0/baseline
```

## What's in the commit

Commit `1da9d23` on branch `p0/baseline`:

```
P0: baseline — pre-flight snapshot before clean rebuild

 baseline/p0-advisors.json          (mini-advisor synthesis)
 baseline/p0-edgefns.md             (26 edge functions, KEEP/CLEAN/DROP)
 baseline/p0-env-inventory.md       (Netlify env vars, both sites)
 baseline/p0-rowcounts.csv          (72 tables, exact row counts)
 baseline/p0-snapshot.md            (snapshot procedure + summary)
 baseline/p0-storefront-assets.md   (asset inventory + recovery instructions)

 6 files changed, 420 insertions(+)
```

No code changes. Pure baseline anchor for the rebuild.
