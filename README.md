# SweetBonb Telegram Bot

Node.js replacement for the N8N-based `@sweetbonb_bot` Telegram AI assistant.

## Stack

- Hono webhook server
- Grammy Telegram bot
- DeepSeek API (OpenAI-compatible)
- MySQL (`sweetbonb-tgbot` on DigitalOcean)

## Features

- AI chat with 甜妹 persona (`sb-main` agent)
- Match analysis (`sb-match` agent) via `/start match-{id}`
- Admin agent (`sb-admin`) for bot admin user
- Tool calling compatible with legacy N8N tools:
  - `member_info`, `edit_g_info`
  - `get_post_data`, `save_post_data`, `check_post_data`
  - `channel_info`, `check_member`
  - `match_request`, `match_reply`
- Message logging to `msg_record` and `n8n_msg_record`

## Local development

```bash
cp .env.example .env
# fill DATABASE_URL, DEEPSEEK_API_KEY
npm install
npm run dev
```

## Deploy (DigitalOcean App Platform)

Uses `.do/app.yaml` with existing MySQL cluster `db-wwferic` / database `sweetbonb-tgbot`.

Required secrets in DO:
- `DEEPSEEK_API_KEY`
- `TELEGRAM_WEBHOOK_SECRET`
- `WEBHOOK_BASE_URL` (your app URL, e.g. `https://sweetbonb-tg-bot-xxxxx.ondigitalocean.app`)

Bot token is loaded from `n8n_bot_info` table (`BOT_MODE=live`).

## Health check

`GET /health`

## Webhook

`POST /webhook/telegram`
