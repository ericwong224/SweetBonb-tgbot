import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import { getProfile, needsUsernameReminder } from '../db/profile.js';
import { logInfo } from '../ops/runtime-log.js';

const lastReminderAt = new Map<number, number>();
const REMINDER_COOLDOWN_MS = 10 * 60_000;

export function usernameReminderMessage(lang: string | null | undefined): string {
  if (lang === 'en') {
    return [
      'You have not set a Telegram @username yet.',
      'Please go to Telegram → Settings → Username and set one yourself, then send any message here so I can sync it.',
      'You can continue the questionnaire, but @username is required before publishing.',
    ].join('\n');
  }
  if (lang === 'zh-written') {
    return [
      '你尚未設定 Telegram @username。',
      '請到 Telegram → 設定 → 用戶名，自行設定後再發送任何訊息，我會自動同步。',
      '你可以先繼續填寫問卷，但發佈啟示前必須有 @username。',
    ].join('\n');
  }
  return [
    '你仲未設定 Telegram @username。',
    '請到 Telegram → 設定 → 用戶名，自己設定後再 send 任何訊息，我會自動同步。',
    '你可以繼續填問卷，但發佈啟示前一定要有 @username。',
  ].join('\n');
}

export async function sendUsernameReminderIfNeeded(
  ctx: Context,
  config: AppConfig,
  userId: number,
  options?: { force?: boolean },
): Promise<boolean> {
  const profile = await getProfile(config, userId);
  if (!needsUsernameReminder(profile)) {
    lastReminderAt.delete(userId);
    return false;
  }

  const now = Date.now();
  const last = lastReminderAt.get(userId) ?? 0;
  if (!options?.force && now - last < REMINDER_COOLDOWN_MS) return false;

  lastReminderAt.set(userId, now);
  logInfo('profile', 'Username reminder sent', { userId });
  await ctx.reply(usernameReminderMessage(profile?.preferred_language ?? null));
  return true;
}
