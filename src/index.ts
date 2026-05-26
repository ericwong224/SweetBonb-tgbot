import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.js';
import { getBotInfo } from './db/bots.js';
import { createBot, createWebhookHandler, setupWebhook } from './bot/telegram.js';
import { registerBotCommands } from './bot/commands.js';
import { formatAdminErrorAlert, notifyAdminThrottled } from './bot/admin-notify.js';
import { startMsgCleanupJob } from './jobs/msg-cleanup.js';
import { createLogRoutes } from './ops/log-routes.js';
import { logError, logInfo, logWarn, runtimeLog } from './ops/runtime-log.js';
import { verifyDeepSeekApi } from './ai/health.js';

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
  runtimeLog.configure(config.OPS_LOG_MAX_ENTRIES);
  const app = new Hono();
  let ready = false;
  let botInfo: Awaited<ReturnType<typeof getBotInfo>> | null = null;

  app.route('/', createLogRoutes(config));

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

  const deepseekCheck = await verifyDeepSeekApi(config);
  const bot = createBot(config, botInfo);

  if (!deepseekCheck.ok) {
    logWarn('boot', 'DeepSeek API check failed — AI replies will not work until DEEPSEEK_API_KEY is fixed', {
      error: deepseekCheck.error,
    });
    await notifyAdminThrottled(
      bot.api,
      botInfo.bot_admin_id,
      'boot:deepseek-auth',
      formatAdminErrorAlert({
        category: 'boot / DeepSeek API',
        error: deepseekCheck.error ?? 'unknown',
        bot: botInfo.bot_username,
        mode: config.BOT_MODE,
      }),
      30 * 60_000,
    );
  } else {
    logInfo('boot', 'DeepSeek API check passed');
  }
  const webhookHandler = createWebhookHandler(bot, config.TELEGRAM_WEBHOOK_SECRET);
  app.post('/webhook/telegram', async (c) => {
    logInfo('webhook', 'Telegram update received');
    return webhookHandler(c);
  });

  startMsgCleanupJob({ config, api: bot.api, botHandle: botInfo.bot_username });

  if (shouldRegisterWebhook(config.WEBHOOK_BASE_URL)) {
    try {
      await setupWebhook(bot, config.WEBHOOK_BASE_URL, config.TELEGRAM_WEBHOOK_SECRET);
      await registerBotCommands(bot.api);
      logInfo('boot', 'Telegram commands registered');
    } catch (error) {
      logError('boot', 'Webhook or command registration failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      console.error('Webhook registration failed (bot will still serve /webhook/telegram):', error);
    }
  } else if (!config.WEBHOOK_BASE_URL) {
    console.warn('WEBHOOK_BASE_URL not set; webhook not registered (use for local dev only).');
    await registerBotCommands(bot.api).catch(() => undefined);
  }

  ready = true;
  logInfo('boot', 'Bot ready', {
    bot: botInfo.bot_username,
    mode: config.BOT_MODE,
    testMessageAck: config.TEST_MESSAGE_ACK,
  });
  console.log(`Bot ready: @${botInfo.bot_username} (${config.BOT_MODE})`);
  if (config.OPS_LOG_ENABLED) {
    console.log(`Live log: ${config.WEBHOOK_BASE_URL ?? `http://localhost:${config.PORT}`}/ops/logs?token=<OPS_LOG_TOKEN>`);
  }
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
