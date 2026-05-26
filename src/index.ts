import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.js';
import { getBotInfo } from './db/bots.js';
import { createBot, createWebhookHandler, setupWebhook } from './bot/telegram.js';
import { startMsgCleanupJob } from './jobs/msg-cleanup.js';

function shouldRegisterWebhook(baseUrl: string | undefined): baseUrl is string {
  if (!baseUrl) return false;
  if (/placeholder/i.test(baseUrl)) {
    console.warn('WEBHOOK_BASE_URL is a placeholder; skipping Telegram webhook registration.');
    return false;
  }
  return true;
}

async function main() {
  const config = loadConfig();
  const app = new Hono();
  let ready = false;
  let botInfo: Awaited<ReturnType<typeof getBotInfo>> | null = null;

  app.get('/health', (c) =>
    c.json({
      ok: ready,
      service: 'sweetbonb-tg',
      bot: botInfo?.bot_username ?? null,
      mode: config.BOT_MODE,
    }, ready ? 200 : 503),
  );

  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`SweetBonb TG bot listening on http://localhost:${info.port}`);
  });

  botInfo = await getBotInfo(config, config.BOT_MODE);
  if (!botInfo) {
    throw new Error(`Bot info not found for mode: ${config.BOT_MODE}`);
  }

  const bot = createBot(config, botInfo);
  const webhookHandler = createWebhookHandler(bot, config.TELEGRAM_WEBHOOK_SECRET);
  app.post('/webhook/telegram', async (c) => webhookHandler(c));

  startMsgCleanupJob({ config, api: bot.api, botHandle: botInfo.bot_username });

  if (shouldRegisterWebhook(config.WEBHOOK_BASE_URL)) {
    try {
      await setupWebhook(bot, config.WEBHOOK_BASE_URL, config.TELEGRAM_WEBHOOK_SECRET);
    } catch (error) {
      console.error('Webhook registration failed (bot will still serve /webhook/telegram):', error);
    }
  } else if (!config.WEBHOOK_BASE_URL) {
    console.warn('WEBHOOK_BASE_URL not set; webhook not registered (use for local dev only).');
  }

  ready = true;
  console.log(`Bot ready: @${botInfo.bot_username} (${config.BOT_MODE})`);
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
