import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.js';
import { getBotInfo } from './db/bots.js';
import { createBot, createWebhookHandler, setupWebhook } from './bot/telegram.js';

async function main() {
  const config = loadConfig();
  const botInfo = await getBotInfo(config, config.BOT_MODE);

  if (!botInfo) {
    throw new Error(`Bot info not found for mode: ${config.BOT_MODE}`);
  }

  const bot = createBot(config, botInfo);
  const webhookHandler = createWebhookHandler(bot, config.TELEGRAM_WEBHOOK_SECRET);

  const app = new Hono();

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'sweetbonb-tg',
      bot: botInfo.bot_username,
      mode: config.BOT_MODE,
    }),
  );

  app.post('/webhook/telegram', async (c) => webhookHandler(c));

  if (config.WEBHOOK_BASE_URL) {
    await setupWebhook(bot, config.WEBHOOK_BASE_URL, config.TELEGRAM_WEBHOOK_SECRET);
  } else {
    console.warn('WEBHOOK_BASE_URL not set; webhook not registered (use for local dev only).');
  }

  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`SweetBonb TG bot listening on http://localhost:${info.port}`);
    console.log(`Bot: @${botInfo.bot_username} (${config.BOT_MODE})`);
  });
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
