import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import {
  checkPostResponsesComplete,
  getPostFieldDefs,
  savePostResponse,
  type PostFieldDef,
} from '../db/post-fields.js';
import { getProfile, updateProfileField } from '../db/profile.js';
import { resolveUserStage } from '../flow/stages.js';
import {
  getNextMissingChoiceFieldOrdered,
  getNextMissingQuestionnaireField,
  QUESTIONNAIRE_FIELD_ORDER,
} from './questionnaire-order.js';
import { logInfo } from '../ops/runtime-log.js';
import {
  GENDER_OPTIONS,
  genderLabel,
  getFieldOptions,
  fieldHasChoiceOptions,
  matchChoiceFieldOption,
  parseGenderInput,
} from './field-choices.js';
import { deleteMessageSafe } from './language-flow.js';
import { WELCOME_AFTER_LANGUAGE } from './commands.js';
import {
  clearQuestionPrompt,
  markQuestionPrompted,
  wasQuestionPrompted,
} from './questionnaire-prompt.js';

export { getFieldOptions, fieldHasChoiceOptions } from './field-choices.js';

const choiceOptionsByUser = new Map<string, string[]>();

function choiceKey(userId: number, fieldKey: string): string {
  return `${userId}:${fieldKey}`;
}

export function storeChoiceOptions(userId: number, fieldKey: string, options: string[]): void {
  choiceOptionsByUser.set(choiceKey(userId, fieldKey), options);
}

export function resolveChoiceIndex(userId: number, fieldKey: string, index: number): string | null {
  const options = choiceOptionsByUser.get(choiceKey(userId, fieldKey));
  if (!options || index < 0 || index >= options.length) return null;
  return options[index] ?? null;
}

export function fieldChoiceKeyboard(
  userId: number,
  fieldKey: string,
  options: string[],
): InlineKeyboard {
  storeChoiceOptions(userId, fieldKey, options);
  const kb = new InlineKeyboard();
  const columns = fieldKey === 'target_age' ? 2 : 1;
  options.forEach((label, index) => {
    kb.text(label, `pick:${fieldKey}:${index}`);
    if ((index + 1) % columns === 0 || index === options.length - 1) {
      kb.row();
    }
  });
  return kb;
}

export function matchReplyKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('接受', 'match:accept').text('拒絕', 'match:reject');
}

export function genderKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const opt of GENDER_OPTIONS) {
    kb.text(opt.label, `gender:${opt.value}`);
  }
  return kb;
}

export async function sendGenderPicker(ctx: Context, lang: string | null | undefined): Promise<void> {
  const formal = lang === 'zh-written';
  const en = lang === 'en';
  const text = en
    ? 'Please choose your gender (required):'
    : formal
      ? '請選擇你的性別（必須選擇，只有男/女）：'
      : '請選擇你嘅性別（一定要揀，只有男/女）：';
  await ctx.reply(text, { reply_markup: genderKeyboard() });
}

export async function sendFieldChoicePicker(
  ctx: Context,
  userId: number,
  field: PostFieldDef,
  options: string[],
  lang: string | null | undefined,
): Promise<void> {
  const formal = lang === 'zh-written';
  const en = lang === 'en';
  const label = field.label_zh || field.field_key;
  const text =
    field.field_key === 'target_age'
      ? en
        ? `Please choose target age — range (e.g. 18-20) or minimum (e.g. 20+):`
        : formal
          ? `請選擇期望對象年齡：範圍（如 18-20）或最低年齡（如 20+，即 20 歲或以上）`
          : `請揀期望對象年齡：範圍（如 18-20）或最低年齡（如 20+，即 20 歲或以上）`
      : en
        ? `Please choose: ${label}`
        : formal
          ? `請選擇：${label}`
          : `請揀：${label}`;
  await ctx.reply(text, {
    reply_markup: fieldChoiceKeyboard(userId, field.field_key, options),
  });
  markQuestionPrompted(userId, field.field_key, 'choice');
}

export async function sendTextFieldPrompt(
  ctx: Context,
  userId: number,
  field: PostFieldDef,
  lang: string | null | undefined,
): Promise<void> {
  const formal = lang === 'zh-written';
  const en = lang === 'en';
  const label = field.label_zh || field.field_key;
  const hint = field.hint?.trim();
  const text = en
    ? `Please enter: ${label}${hint ? `\n${hint}` : ''}`
    : formal
      ? `請輸入：${label}${hint ? `\n（${hint}）` : ''}`
      : `請輸入：${label}${hint ? `\n（${hint}）` : ''}`;
  await ctx.reply(text);
  markQuestionPrompted(userId, field.field_key, 'text');
}

async function promptNextQuestionnaireField(
  ctx: Context,
  config: AppConfig,
  userId: number,
): Promise<boolean> {
  const profile = await getProfile(config, userId);
  const lang = profile?.preferred_language ?? null;
  const next = await getNextMissingQuestionnaireField(config, userId);
  if (!next) {
    const { ensureAcceptanceOrPrompt } = await import('./acceptance-flow.js');
    await ensureAcceptanceOrPrompt(ctx, config, '', { forcePrompt: true });
    return true;
  }
  if (wasQuestionPrompted(userId, next.field.field_key)) return false;
  if (next.options?.length) {
    await sendFieldChoicePicker(ctx, userId, next.field, next.options, lang);
  } else {
    await sendTextFieldPrompt(ctx, userId, next.field, lang);
  }
  return true;
}

export async function getNextMissingChoiceField(
  config: AppConfig,
  userId: number,
): Promise<{ field: PostFieldDef; options: string[] } | null> {
  const stage = await resolveUserStage(config, userId);
  if (stage === 'profile_incomplete' || stage === 'post_published') return null;
  return getNextMissingChoiceFieldOrdered(config, userId);
}

export async function tryApplyGenderFromText(
  ctx: Context,
  config: AppConfig,
  userId: number,
  text: string,
): Promise<boolean> {
  const parsed = parseGenderInput(text);
  if (!parsed) return false;

  await updateProfileField(config, userId, 'gender', parsed);
  logInfo('profile', 'Gender set from text', { userId, gender: parsed });
  await ctx.reply(`已記錄性別：${genderLabel(parsed)}`);
  return true;
}

export async function applyGenderChoice(
  ctx: Context,
  config: AppConfig,
  userId: number,
  value: 'M' | 'F',
): Promise<void> {
  await updateProfileField(config, userId, 'gender', value);
  logInfo('profile', 'Gender set from button', { userId, gender: value });

  const callbackMessage = ctx.callbackQuery?.message;
  if (callbackMessage) {
    await deleteMessageSafe(ctx.api, callbackMessage.chat.id, callbackMessage.message_id);
  }

  await ctx.answerCallbackQuery({ text: `已選擇：${genderLabel(value)}` });
  await ctx.reply(`已記錄性別：${genderLabel(value)}`);
}

export async function applyFieldChoice(
  ctx: Context,
  config: AppConfig,
  userId: number,
  fieldKey: string,
  index: number,
): Promise<boolean> {
  const value = resolveChoiceIndex(userId, fieldKey, index);
  if (!value) {
    await ctx.answerCallbackQuery({ text: '選項已過期，請重新選擇' });
    return false;
  }

  await savePostResponse(config, userId, fieldKey, value);
  clearQuestionPrompt(userId, fieldKey);
  await resolveUserStage(config, userId);
  logInfo('post', 'Choice field set from button', { userId, field: fieldKey, value });

  const callbackMessage = ctx.callbackQuery?.message;
  if (callbackMessage) {
    await deleteMessageSafe(ctx.api, callbackMessage.chat.id, callbackMessage.message_id);
  }

  await ctx.answerCallbackQuery({ text: `已選擇：${value}` });
  await ctx.reply(`已記錄：${value}`);
  return true;
}

export async function ensureGenderOrPrompt(
  ctx: Context,
  config: AppConfig,
  userText: string,
): Promise<'ready' | 'prompted' | 'just_set'> {
  const from = ctx.from;
  if (!from) return 'prompted';

  const profile = await getProfile(config, from.id);
  if (profile?.gender) return 'ready';

  const skipPrompt =
    userText === '你好，我剛開始使用 SweetBonb。' || userText === WELCOME_AFTER_LANGUAGE;
  if (!skipPrompt && (await tryApplyGenderFromText(ctx, config, from.id, userText))) {
    return 'just_set';
  }

  if (!skipPrompt && userText.trim()) {
    const lang = profile?.preferred_language ?? null;
    const en = lang === 'en';
    await ctx.reply(
      en
        ? 'Gender must be Male or Female. Please use the buttons below:'
        : '性別只有「男」或「女」，請用下面按鈕選擇：',
    );
  }

  await sendGenderPicker(ctx, profile?.preferred_language ?? null);
  return 'prompted';
}

export async function tryApplyAnyMissingChoiceFromText(
  ctx: Context,
  config: AppConfig,
  userId: number,
  text: string,
): Promise<boolean> {
  const skipPrompt =
    text === '你好，我剛開始使用 SweetBonb。' || text === WELCOME_AFTER_LANGUAGE;
  if (skipPrompt || !text.trim()) return false;

  const defs = await getPostFieldDefs(config);
  const defMap = new Map(defs.map((d) => [d.field_key, d]));
  const { missing } = await checkPostResponsesComplete(config, userId);

  for (const key of QUESTIONNAIRE_FIELD_ORDER) {
    if (!missing.includes(key)) continue;
    const field = defMap.get(key);
    if (!field || !fieldHasChoiceOptions(field)) continue;
    const options = getFieldOptions(field);
    const matched = matchChoiceFieldOption(field.field_key, options, text);
    if (!matched) continue;

    await savePostResponse(config, userId, field.field_key, matched);
    clearQuestionPrompt(userId, field.field_key);
    await resolveUserStage(config, userId);
    logInfo('post', 'Choice field set from text', {
      userId,
      field: field.field_key,
      value: matched,
    });
    await ctx.reply(`已記錄：${field.label_zh} → ${matched}`);
    return true;
  }
  return false;
}

export async function tryApplyTextFieldFromText(
  ctx: Context,
  config: AppConfig,
  userId: number,
  text: string,
): Promise<boolean> {
  const skipPrompt =
    text === '你好，我剛開始使用 SweetBonb。' || text === WELCOME_AFTER_LANGUAGE;
  if (skipPrompt || !text.trim()) return false;

  const next = await getNextMissingQuestionnaireField(config, userId);
  if (!next || next.options?.length) return false;
  if (next.field.field_key === 'acceptance_questionnaire') return false;

  const value = text.trim();
  if (!value) return false;

  await savePostResponse(config, userId, next.field.field_key, value);
  clearQuestionPrompt(userId, next.field.field_key);
  await resolveUserStage(config, userId);
  logInfo('post', 'Text field set from message', {
    userId,
    field: next.field.field_key,
    value: value.slice(0, 80),
  });
  await ctx.reply(`已記錄：${next.field.label_zh} → ${value}`);
  return true;
}

export async function ensurePostChoiceOrPrompt(
  ctx: Context,
  config: AppConfig,
  userText: string,
): Promise<'ready' | 'just_set'> {
  const from = ctx.from;
  if (!from) return 'ready';
  const applied = await tryApplyAnyMissingChoiceFromText(ctx, config, from.id, userText);
  return applied ? 'just_set' : 'ready';
}

export async function sendFollowUpPickers(
  ctx: Context,
  config: AppConfig,
  userId: number,
): Promise<void> {
  await promptNextQuestionnaireField(ctx, config, userId);
}

/** Advance to the next questionnaire step after an answer is saved. */
export async function continueQuestionnaireStep(
  ctx: Context,
  config: AppConfig,
  userId: number,
): Promise<void> {
  await promptNextQuestionnaireField(ctx, config, userId);
}

function isSyntheticUserText(text: string): boolean {
  return text === WELCOME_AFTER_LANGUAGE || text === '你好，我剛開始使用 SweetBonb。';
}

/** Bot-driven questionnaire: apply answers, prompt next field, never repeat the same question. */
export async function ensureQuestionnaireContinuation(
  ctx: Context,
  config: AppConfig,
  userId: number,
  userText: string,
): Promise<'ready' | 'handled' | 'waiting'> {
  const { hasAcceptanceInProgress } = await import('./acceptance-flow.js');
  if (hasAcceptanceInProgress(userId)) return 'ready';

  const stage = await resolveUserStage(config, userId);
  if (stage !== 'profile_complete' && stage !== 'post_ready') return 'ready';

  const { complete } = await checkPostResponsesComplete(config, userId);
  if (complete) return 'ready';

  if (!isSyntheticUserText(userText) && userText.trim()) {
    if (await tryApplyAnyMissingChoiceFromText(ctx, config, userId, userText)) {
      await continueQuestionnaireStep(ctx, config, userId);
      return 'handled';
    }
    if (await tryApplyTextFieldFromText(ctx, config, userId, userText)) {
      await continueQuestionnaireStep(ctx, config, userId);
      return 'handled';
    }
  }

  const next = await getNextMissingQuestionnaireField(config, userId);
  if (!next) return 'ready';

  if (wasQuestionPrompted(userId, next.field.field_key)) {
    if (!isSyntheticUserText(userText) && userText.trim()) {
      const profile = await getProfile(config, userId);
      const en = profile?.preferred_language === 'en';
      await ctx.reply(
        next.options?.length
          ? en
            ? 'Please use the buttons below.'
            : '請用下面嘅按鈕選擇～'
          : en
            ? `Please enter: ${next.field.label_zh}`
            : `請輸入：${next.field.label_zh}`,
      );
    }
    return 'waiting';
  }

  await promptNextQuestionnaireField(ctx, config, userId);
  return 'waiting';
}

export async function beginQuestionnaire(
  ctx: Context,
  config: AppConfig,
  userId: number,
): Promise<void> {
  clearQuestionPrompt(userId);
  const profile = await getProfile(config, userId);
  const lang = profile?.preferred_language ?? null;
  const en = lang === 'en';
  await ctx.reply(
    en ? 'Basic profile done! One question at a time～' : '基本資料搞掂！我會逐題問你～',
  );
  const { sendUsernameReminderIfNeeded } = await import('./profile-flow.js');
  await sendUsernameReminderIfNeeded(ctx, config, userId, { force: true });
  await promptNextQuestionnaireField(ctx, config, userId);
}
