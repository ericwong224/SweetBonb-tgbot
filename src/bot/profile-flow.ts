import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import {
  getProfile,
  isCoreProfileComplete,
  needsUsernameReminder,
  updateProfileField,
  type UserProfileRow,
} from '../db/profile.js';
import { logInfo } from '../ops/runtime-log.js';
import { WELCOME_AFTER_LANGUAGE } from './commands.js';

const lastReminderAt = new Map<number, number>();
const REMINDER_COOLDOWN_MS = 10 * 60_000;

export type CoreProfileField = 'gender' | 'dob' | 'location';

export function getNextCoreProfileField(profile: UserProfileRow | null): CoreProfileField | null {
  if (!profile?.gender) return 'gender';
  if (!profile?.dob) return 'dob';
  if (!profile?.location?.trim()) return 'location';
  return null;
}

export function parseDobInput(text: string): string | null {
  const t = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const age = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age < 18) return null;
  return t;
}

function coreProfilePrompt(field: CoreProfileField, lang: string | null | undefined): string {
  if (field === 'dob') {
    if (lang === 'en') return 'Next: please enter your date of birth (YYYY-MM-DD, must be 18+):';
    if (lang === 'zh-written') return '下一題：請輸入你的出生日期（YYYY-MM-DD，須年滿 18 歲）：';
    return '下一題：請輸入你嘅出生日期（YYYY-MM-DD，要滿 18 歲）：';
  }
  if (lang === 'en') {
    return 'Next: where do you live? (e.g. 香港-九龍 / 台灣-台北 / 中国-广东-深圳)';
  }
  if (lang === 'zh-written') {
    return '下一題：請輸入你的現居地（例如：香港-九龍、台灣-台北、中国-广东-深圳）：';
  }
  return '下一題：請輸入你嘅現居地（例如：香港-九龍、台灣-台北、中国-广东-深圳）：';
}

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

export async function promptNextCoreProfileField(
  ctx: Context,
  config: AppConfig,
  userId: number,
): Promise<boolean> {
  const profile = await getProfile(config, userId);
  const next = getNextCoreProfileField(profile);
  if (!next || next === 'gender') return false;

  const lang = profile?.preferred_language ?? null;
  await ctx.reply(coreProfilePrompt(next, lang));
  logInfo('profile', 'Core profile prompt sent', { userId, field: next });
  return true;
}

export async function tryApplyCoreFieldFromText(
  ctx: Context,
  config: AppConfig,
  userId: number,
  text: string,
): Promise<boolean> {
  const profile = await getProfile(config, userId);
  const next = getNextCoreProfileField(profile);
  if (!next || next === 'gender') return false;

  const lang = profile?.preferred_language ?? null;

  if (next === 'dob') {
    const dob = parseDobInput(text);
    if (!dob) return false;
    await updateProfileField(config, userId, 'dob', dob);
    logInfo('profile', 'DOB saved from text', { userId, dob });
    await ctx.reply(`已記錄出生日期：${dob}`);
    await promptNextCoreProfileField(ctx, config, userId);
    return true;
  }

  const location = text.trim();
  if (location.length < 2) return false;
  await updateProfileField(config, userId, 'location', location);
  logInfo('profile', 'Location saved from text', { userId, location });
  await ctx.reply(`已記錄現居地：${location}`);
  return true;
}

/** Bot-driven basic profile: gender/dob/location before questionnaire. */
export async function ensureCoreProfileContinuation(
  ctx: Context,
  config: AppConfig,
  userText: string,
): Promise<'ready' | 'prompted' | 'just_set' | 'questionnaire_start'> {
  const from = ctx.from;
  if (!from) return 'ready';

  const profile = await getProfile(config, from.id);
  if (isCoreProfileComplete(profile)) return 'ready';

  const skipParse =
    userText === WELCOME_AFTER_LANGUAGE || userText === '你好，我剛開始使用 SweetBonb。';

  if (!skipParse && (await tryApplyCoreFieldFromText(ctx, config, from.id, userText))) {
    const updated = await getProfile(config, from.id);
    if (isCoreProfileComplete(updated)) return 'questionnaire_start';
    return 'just_set';
  }

  const prompted = await promptNextCoreProfileField(ctx, config, from.id);
  return prompted ? 'prompted' : 'ready';
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

export async function continueAfterCoreFieldSaved(
  ctx: Context,
  config: AppConfig,
  userId: number,
): Promise<void> {
  const profile = await getProfile(config, userId);
  if (!isCoreProfileComplete(profile)) {
    await promptNextCoreProfileField(ctx, config, userId);
    return;
  }
  const { beginQuestionnaire } = await import('./choice-flow.js');
  await beginQuestionnaire(ctx, config, userId);
}
