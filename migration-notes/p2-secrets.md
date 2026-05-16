# P2 — Edge Function Secrets

Target project: `ihnnipynpdtcbdfbpemq` (`mrbeanies-prod`)

## Auto-injected by Supabase (already set)

| Secret | Value source | Used by |
|---|---|---|
| `SUPABASE_URL` | platform default | every fn |
| `SUPABASE_SERVICE_ROLE_KEY` | platform default | every fn |
| `SUPABASE_ANON_KEY` | platform default | none currently |

## Secrets YOU need to set on `mrbeanies-prod`

These are **owner-only values** the cowork sandbox cannot generate. Set each via:

```
Supabase Dashboard → Project ihnnipynpdtcbdfbpemq → Project Settings → Edge Functions → Secrets
```

| Secret | Used by | Where to get the value |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `place-order`, `notify-customer`, `telegram-webhook`, `setup-telegram-webhook` | Telegram → @BotFather → /newbot (or copy current token from old project for now, swap to a new bot at P8) |
| `TELEGRAM_OWNER_CHAT_ID` | `place-order` | Telegram → DM @userinfobot → copy your chat_id |

## Secrets that are optional / latent

| Secret | Used by | Notes |
|---|---|---|
| `LALAMOVE_API_KEY` / `LALAMOVE_API_SECRET` | `delivery-quote` | If absent, function falls back to estimate mode (works). Set later if you want live Lalamove pricing |
| `UPDATE_ORDER_ADMIN_KEY` | `update-order` (after P3 refactor) | P3 will replace the hardcoded `'mrg-admin-2026'` constant with this env var |

## Same secrets on the OLD project

The OLD project (`ckmnhgattkiziuykhczo`) already has `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_CHAT_ID` set — that's why the live storefront's Telegram alerts work today. You can either:

1. **Copy the same values** to `mrbeanies-prod` for parity testing now (the same bot DMs both old and new); the new bot rotation is the P8 task.
2. **Create a new bot now** via @BotFather and use its token. The old bot stays on the live stack until cutover.

Option 1 is faster for P2/P3/P4 validation. Option 2 is cleaner long-term but adds a step now.

## Mini-checklist

- [ ] `TELEGRAM_BOT_TOKEN` set on `mrbeanies-prod`
- [ ] `TELEGRAM_OWNER_CHAT_ID` set on `mrbeanies-prod`
- [ ] `LALAMOVE_API_KEY` (optional; can leave blank)
- [ ] `LALAMOVE_API_SECRET` (optional; can leave blank)

Once those two are set, every deployed edge function on `mrbeanies-prod` will work end-to-end against the empty DB. We test that during P5 with row-count parity checks.
