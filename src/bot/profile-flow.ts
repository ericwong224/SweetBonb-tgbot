import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import { getChannelInfo } from '../db/posts.js';
import {
  getMissingCoreProfileFields,
  getProfile,
  needsUsernameReminder,
  updateProfileField,
} from '../db/profile.js';
import { logInfo } from '../ops/runtime-log.js';
import { WELCOME_AFTER_LANGUAGE } from './commands.js';

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

const locationOptionsByUser = new Map<number, string[]>();

function profilePromptText(
  lang: string | null | undefined,
  variants: { en: string; formal: string; spoken: string },
): string {
  if (lang === 'en') return variants.en;
  if (lang === 'zh-written') return variants.formal;
  return variants.spoken;
}

function validateDob(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export async function tryApplyCoreProfileFromText(
  ctx: Context,
  config: AppConfig,
  userId: number,
  text: string,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed || trimmed === WELCOME_AFTER_LANGUAGE) return false;

  const profile = await getProfile(config, userId);
  const missing = getMissingCoreProfileFields(profile);
  const lang = profile?.preferred_language ?? null;

  if (missing.includes('dob') && validateDob(trimmed)) {
    await updateProfileField(config, userId, 'dob', trimmed);
    logInfo('profile', 'DOB set from text', { userId, dob: trimmed });
    await ctx.reply(
      profilePromptText(lang, {
        en: `Date of birth recorded: ${trimmed}`,
        formal: `已記錄出生日期：${trimmed}`,
        spoken: `已記錄出生日期：${trimmed}`,
      }),
    );
    return true;
  }

  if (missing.includes('location')) {
    const channels = await getChannelInfo(config);
    const areas = [
      ...new Set(
        channels
          .map((row) => String(row.area ?? '').trim())
          .filter((area) => area.length > 0),
      ),
    ];
    const matched =
      areas.find((area) => area === trimmed) ??
      areas.find((area) => trimmed.includes(area) || area.includes(trimmed));
    if (matched) {
      await updateProfileField(config, userId, 'location', matched);
      logInfo('profile', 'Location set from text', { userId, location: matched });
      await ctx.reply(
        profilePromptText(lang, {
          en: `Location recorded: ${matched}`,
          formal: `已記錄居住地：${matched}`,
          spoken: `已記錄居住地：${matched}`,
        }),
      );
      return true;
    }
  }

  return false;
}

export function shouldSendCoreProfileFollowUp(
  stage: string,
  profile: Awaited<ReturnType<typeof getProfile>>,
  aiReply: string,
): boolean {
  if (stage !== 'profile_incomplete') return false;
  const missing = getMissingCoreProfileFields(profile);
  if (missing.length === 0) return false;

  const reply = aiReply.toLowerCase();
  if (missing.includes('dob')) {
    const askedDob =
      reply.includes('出生') ||
      reply.includes('birth') ||
      reply.includes('yyyy') ||
      reply.includes('日期');
    if (!askedDob) return true;
  }
  if (missing.includes('location')) {
    const askedLocation =
      reply.includes('居住') ||
      reply.includes('地區') ||
      reply.includes('location') ||
      reply.includes('live') ||
      reply.includes('住');
    if (!askedLocation) return true;
  }
  return false;
}

export async function sendNextCoreProfilePromptIfNeeded(
  ctx: Context,
  config: AppConfig,
  userId: number,
): Promise<boolean> {
  const profile = await getProfile(config, userId);
  const missing = getMissingCoreProfileFields(profile);
  if (missing.length === 0) return false;

  const lang = profile?.preferred_language ?? null;
  const next = missing[0];

  if (next === 'dob') {
    await ctx.reply(
      profilePromptText(lang, {
        en: 'Please enter your date of birth (YYYY-MM-DD, e.g. 1995-03-15):',
        formal: '請輸入你的出生日期（格式 YYYY-MM-DD，例如 1995-03-15）：',
        spoken: '請輸入你嘅出生日期（格式 YYYY-MM-DD，例如 1995-03-15）：',
      }),
    );
    return true;
  }

  if (next === 'location') {
    const channels = await getChannelInfo(config);
    const areas = [
      ...new Set(
        channels
          .map((row) => String(row.area ?? '').trim())
          .filter((area) => area.length > 0),
      ),
    ];
    if (areas.length > 0) {
      locationOptionsByUser.set(userId, areas);
      const kb = new InlineKeyboard();
      areas.forEach((area, index) => {
        kb.text(area, `loc:${index}`);
        if ((index + 1) % 2 === 0 || index === areas.length - 1) kb.row();
      });
      await ctx.reply(
        profilePromptText(lang, {
          en: 'Please choose where you live:',
          formal: '請選擇你現時居住的地區：',
          spoken: '請揀你而家住嘅地區：',
        }),
        { reply_markup: kb },
      );
      return true;
    }

    await ctx.reply(
      profilePromptText(lang, {
        en: 'Please enter where you live (e.g. Hong Kong Island, Kowloon):',
        formal: '請輸入你現時居住的地區（例如港島、九龍）：',
        spoken: '請輸入你而家住嘅地區（例如港島、九龍）：',
      }),
    );
    return true;
  }

  return false;
}

export function resolveLocationChoice(userId: number, index: number): string | null {
  const options = locationOptionsByUser.get(userId);
  if (!options || index < 0 || index >= options.length) return null;
  return options[index] ?? null;
}

export async function applyLocationChoice(
  ctx: Context,
  config: AppConfig,
  userId: number,
  index: number,
): Promise<boolean> {
  const value = resolveLocationChoice(userId, index);
  if (!value) {
    await ctx.answerCallbackQuery({ text: '選項已過期，請重新選擇' });
    return false;
  }

  await updateProfileField(config, userId, 'location', value);
  logInfo('profile', 'Location set from button', { userId, location: value });

  const callbackMessage = ctx.callbackQuery?.message;
  if (callbackMessage) {
    const { deleteMessageSafe } = await import('./language-flow.js');
    await deleteMessageSafe(ctx.api, callbackMessage.chat.id, callbackMessage.message_id);
  }

  await ctx.answerCallbackQuery({ text: `已選擇：${value}` });
  await ctx.reply(`已記錄居住地：${value}`);
  return true;
}
