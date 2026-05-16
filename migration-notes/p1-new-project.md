# P1 — New Project Credentials

**`mrbeanies-prod`** — the clean MBG-only Supabase project.

| Field | Value |
|---|---|
| Project name | `mrbeanies-prod` |
| Project ref | `ihnnipynpdtcbdfbpemq` |
| URL | `https://ihnnipynpdtcbdfbpemq.supabase.co` |
| Organization | TechvisioPH (`qkghibzzknbdzgqbhfty`) |
| Region | ap-northeast-1 (Tokyo) — matches old project |
| Status | ACTIVE_HEALTHY |
| Postgres | 17.x (latest minor on Supabase Free) |
| Plan | Free |
| Created at | 2026-05-15T10:47:47Z |

## API keys

### Anon JWT (public — safe in browser code)

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlobm5pcHlucGR0Y2JkZmJwZW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NDIwNjcsImV4cCI6MjA5NDQxODA2N30.RgSQY_odbIR0vdfGqcdN0aTDyKlBcbrDC35iAKSGRKo
```

JWT decoded: `iss=supabase`, `ref=ihnnipynpdtcbdfbpemq`, `role=anon`, `iat=2026-05-15`, `exp=2036-05-13`.

### Publishable key (modern format — recommended for new code)

```
sb_publishable_ZwqI1esHoKI61Hn2NbTGwQ_ZZs0TAE0
```

Functionally equivalent to the anon JWT for client SDKs, but easier to rotate independently. Either one works.

### Service-role key

NOT included in this file by design. Pull it from Supabase Dashboard → Project Settings → API. **Set it only as a Supabase edge function secret — never as a Netlify env var, never in committed code.**

## Old vs new — for downstream phase use

| Var | Old (live) | New (`mrbeanies-prod`) |
|---|---|---|
| `SUPABASE_URL` | `https://ckmnhgattkiziuykhczo.supabase.co` | `https://ihnnipynpdtcbdfbpemq.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJ…l2ErPyJe6q2sI4UpNtRp9qRfeVkfdrHSOdkensj83IA` | `eyJ…RgSQY_odbIR0vdfGqcdN0aTDyKlBcbrDC35iAKSGRKo` |

`mrbeanies-prod` will be the value of these env vars on both new Netlify sites (storefront + dashboard) after P4 cutover.

## Storage buckets

Not created yet — storage is migrated in **P6** after data is in place.

## What changed on the old project to make room

The empty decoy `flncnumpwvkgtkegumqq` was **paused** to free the Free-tier 2-project slot. It's recoverable for 30 days; deletion (a separate user action) can follow once the new project is stable.

## Next steps for downstream phases

- **P2:** port edge functions to this project_id (`ihnnipynpdtcbdfbpemq`). 14 KEEP + 2 verify-first edge functions per `/outputs/p0-edgefns.md`.
- **P3:** code clean-up (COD strip, minimal Telegram messages, hardcoded URL swaps, RLS policy de-duplication).
- **P4:** create new Netlify sites pointing at this project's URL + anon key.
- **P5:** data migration with row-count parity gates per `/outputs/p0-rowcounts.csv`.
- **P6:** storage bucket migration.
- **P7:** cutover.
