import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import { getPostResponseMap, savePostResponse } from '../db/post-fields.js';
import { getProfile } from '../db/profile.js';
import { resolveUserStage } from '../flow/stages.js';
import { logInfo } from '../ops/runtime-log.js';
import { deleteMessageSafe } from './language-flow.js';
import { WELCOME_AFTER_LANGUAGE } from './commands.js';
import { buildAcceptanceIntro, type SavedFieldAnswer } from './questionnaire-copy.js';
import {
  logQuestionnaireBotPrompt,
  type QuestionnaireLogContext,
} from './questionnaire-log.js';
import {
  clearQuestionPrompt,
  markQuestionPrompted,
  wasAcceptanceItemPrompted,
} from './questionnaire-prompt.js';

export const ACCEPTANCE_ITEMS_F = ['接吻', '為對方口交', 'SM', '野戰'];
export const ACCEPTANCE_ITEMS_M = ['接吻', '為對方口交', '口爆', '無套', '內射', '肛交', 'SM', '野戰'];

export const ACCEPTANCE_LEVELS = [
  { label: '✅ 可以', emoji: '✅' },
  { label: '❌ 唔得', emoji: '❌' },
  { label: '❓ 視乎情況', emoji: '❓' },
] as const;

interface AcceptanceProgress {
  items: string[];
  answers: string[];
  index: number;
}

const progressByUser = new Map<number, AcceptanceProgress>();

export function hasAcceptanceInProgress(userId: number): boolean {
  return progressByUser.has(userId);
}

function targetGenderLabel(raw: string | undefined): '男' | '女' | null {
  if (!raw) return null;
  const t = raw.trim();
  if (t === '男' || t === 'M' || t.toLowerCase() === 'male') return '男';
  if (t === '女' || t === 'F' || t.toLowerCase() === 'female') return '女';
  return null;
}

export function acceptanceItemsForTarget(targetGender: '男' | '女'): string[] {
  return targetGender === '女' ? [...ACCEPTANCE_ITEMS_F] : [...ACCEPTANCE_ITEMS_M];
}

export function formatAcceptanceQuestionnaire(items: string[], emojis: string[]): string {
  return items.map((item, i) => `${emojis[i] ?? '❓'}${item}`).join(' ');
}

export function acceptanceKeyboard(itemIndex: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  ACCEPTANCE_LEVELS.forEach((level, levelIndex) => {
    kb.text(level.label, `acc:${itemIndex}:${levelIndex}`);
  });
  return kb;
}

export async function sendAcceptanceItemPicker(
  ctx: Context,
  userId: number,
  itemIndex: number,
  itemLabel: string,
  lang: string | null | undefined,
): Promise<void> {
  if (wasAcceptanceItemPrompted(userId, itemIndex)) return;

  const en = lang === 'en';
  const formal = lang === 'zh-written';
  const text = en
    ? `Acceptance: ${itemLabel}`
    : formal
      ? `接受程度 — ${itemLabel}：`
      : `接受程度 — ${itemLabel}：`;
  await ctx.reply(text, { reply_markup: acceptanceKeyboard(itemIndex) });
  markQuestionPrompted(userId, 'acceptance_questionnaire', 'acceptance', itemIndex);
}

export async function applyAcceptanceChoice(
  ctx: Context,
  config: AppConfig,
  userId: number,
  itemIndex: number,
  levelIndex: number,
): Promise<'next' | 'complete' | 'invalid'> {
  const progress = progressByUser.get(userId);
  if (!progress || itemIndex !== progress.index || itemIndex >= progress.items.length) {
    await ctx.answerCallbackQuery({ text: '請重新開始問卷' });
    return 'invalid';
  }

  const level = ACCEPTANCE_LEVELS[levelIndex];
  if (!level) {
    await ctx.answerCallbackQuery({ text: 'Invalid option' });
    return 'invalid';
  }

  progress.answers[itemIndex] = level.emoji;
  progress.index += 1;

  const callbackMessage = ctx.callbackQuery?.message;
  if (callbackMessage) {
    await deleteMessageSafe(ctx.api, callbackMessage.chat.id, callbackMessage.message_id);
  }

  const item = progress.items[itemIndex] ?? '';
  await ctx.answerCallbackQuery({ text: `${item}：${level.label}` });

  if (progress.index >= progress.items.length) {
    const formatted = formatAcceptanceQuestionnaire(progress.items, progress.answers);
    await savePostResponse(config, userId, 'acceptance_questionnaire', formatted);
    clearQuestionPrompt(userId, 'acceptance_questionnaire');
    await resolveUserStage(config, userId);
    progressByUser.delete(userId);
    logInfo('post', 'Acceptance questionnaire complete', { userId, formatted });
    return 'complete';
  }

  const profile = await getProfile(config, userId);
  await sendAcceptanceItemPicker(
    ctx,
    userId,
    progress.index,
    progress.items[progress.index] ?? '',
    profile?.preferred_language ?? null,
  );
  return 'next';
}

export async function startAcceptanceQuestionnaire(
  ctx: Context,
  config: AppConfig,
  userId: number,
  options: {
    previous?: SavedFieldAnswer;
    lang: string | null | undefined;
    log?: QuestionnaireLogContext;
  },
): Promise<void> {
  const postData = await getPostResponseMap(config, userId);
  if (postData.acceptance_questionnaire?.trim()) return;

  const targetGender = targetGenderLabel(postData.target_gender);
  if (!targetGender) return;

  const items = acceptanceItemsForTarget(targetGender);
  progressByUser.set(userId, { items, answers: [], index: 0 });

  const intro = buildAcceptanceIntro(targetGender, options.lang, options.previous);
  await ctx.reply(intro);
  if (options.log) await logQuestionnaireBotPrompt(options.log, intro);

  await sendAcceptanceItemPicker(ctx, userId, 0, items[0] ?? '', options.lang);
}

export async function ensureAcceptanceOrPrompt(
  ctx: Context,
  config: AppConfig,
  userText: string,
  options?: {
    forcePrompt?: boolean;
    previous?: SavedFieldAnswer;
    log?: QuestionnaireLogContext;
  },
): Promise<'ready' | 'prompted' | 'just_set'> {
  const from = ctx.from;
  if (!from) return 'prompted';

  const postData = await getPostResponseMap(config, from.id);
  if (postData.acceptance_questionnaire?.trim()) {
    progressByUser.delete(from.id);
    return 'ready';
  }

  const targetGender = targetGenderLabel(postData.target_gender);
  if (!targetGender) return 'ready';

  const existing = progressByUser.get(from.id);
  if (existing) {
    const profile = await getProfile(config, from.id);
    const skipPrompt =
      userText === WELCOME_AFTER_LANGUAGE || userText === '你好，我剛開始使用 SweetBonb。';
    if (!skipPrompt && userText.trim() && wasAcceptanceItemPrompted(from.id, existing.index)) {
      await ctx.reply('請用下面按鈕選擇接受程度：');
      return 'prompted';
    }
    await sendAcceptanceItemPicker(
      ctx,
      from.id,
      existing.index,
      existing.items[existing.index] ?? '',
      profile?.preferred_language ?? null,
    );
    return 'prompted';
  }

  if (!options?.forcePrompt && userText === WELCOME_AFTER_LANGUAGE) {
    return 'ready';
  }

  const profile = await getProfile(config, from.id);
  await startAcceptanceQuestionnaire(ctx, config, from.id, {
    previous: options?.previous,
    lang: profile?.preferred_language ?? null,
    log: options?.log,
  });
  return 'prompted';
}
