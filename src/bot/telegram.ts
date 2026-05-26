import { Bot, webhookCallback } from 'grammy';
import type { AppConfig } from '../config.js';
import type { BotInfo } from '../db/bots.js';
import { registerHandlers } from './handlers.js';

export function createBot(config: AppConfig, botInfo: BotInfo): Bot {
  const token = config.TELEGRAM_BOT_TOKEN ?? botInfo.bot_token;
  const bot = new Bot(token);
  registerHandlers(bot, { config, botInfo });
  return bot;
}

export function createWebhookHandler(bot: Bot, secret: string) {
  return webhookCallback(bot, 'hono', { secretToken: secret });
}

export async function setupWebhook(
  bot: Bot,
  webhookBaseUrl: string,
  secret: string,
): Promise<void> {
  const url = `${webhookBaseUrl.replace(/\/$/, '')}/webhook/telegram`;
  await bot.api.setWebhook(url, { secret_token: secret, drop_pending_updates: false });
  console.log(`Webhook registered: ${url}`);
}
