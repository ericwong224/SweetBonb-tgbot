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
import { logInfo } from '../ops/runtime-log.js';
import {
  DEFAULT_FIELD_OPTIONS,
  GENDER_OPTIONS,
  genderLabel,
  matchChoiceOption,
  parseGenderInput,
  parseOptionsJson,
} from './field-choices.js';
import { deleteMessageSafe } from './language-flow.js';
import { WELCOME_AFTER_LANGUAGE } from './commands.js';

export function getFieldOptions(field: Pick<PostFieldDef, 'field_key' | 'options_json'>): string[] {
  const fromDb = parseOptionsJson(field.options_json);
  if (fromDb.length) return fromDb;
  return DEFAULT_FIELD_OPTIONS[field.field_key] ?? [];
}

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

export function fieldChoiceKeyboard(userId: number, fieldKey: string, options: string[]): InlineKeyboard {
  storeChoiceOptions(userId, fieldKey, options);
  const kb = new InlineKeyboard();
  options.forEach((label, index) => {
    kb.text(label, `pick:${fieldKey}:${index}`).row();
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
  const text = en
    ? `Please choose: ${label}`
    : formal
      ? `請選擇：${label}`
      : `請揀：${label}`;
  await ctx.reply(text, {
    reply_markup: fieldChoiceKeyboard(userId, field.field_key, options),
  });
}

export async function getNextMissingChoiceField(
  config: AppConfig,
  userId: number,
): Promise<{ field: PostFieldDef; options: string[] } | null> {
  const stage = await resolveUserStage(config, userId);
  if (stage === 'profile_incomplete' || stage === 'post_published') return null;

  const defs = await getPostFieldDefs(config);
  const { missing } = await checkPostResponsesComplete(config, userId);

  for (const field of defs) {
    const isChoice =
      field.field_type === 'choice' ||
      (!field.field_type && field.field_key in DEFAULT_FIELD_OPTIONS);
    if (!isChoice || !missing.includes(field.field_key)) continue;
    const options = getFieldOptions(field);
    if (options.length) return { field, options };
  }
  return null;
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

export async function tryApplyChoiceFromText(
  ctx: Context,
  config: AppConfig,
  userId: number,
  field: PostFieldDef,
  options: string[],
  text: string,
): Promise<boolean> {
  const matched = matchChoiceOption(options, text);
  if (!matched) return false;

  await savePostResponse(config, userId, field.field_key, matched);
  await resolveUserStage(config, userId);
  logInfo('post', 'Choice field set from text', { userId, field: field.field_key, value: matched });
  await ctx.reply(`已記錄：${field.label_zh} → ${matched}`);
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

export async function ensurePostChoiceOrPrompt(
  ctx: Context,
  config: AppConfig,
  userText: string,
): Promise<'ready' | 'prompted' | 'just_set'> {
  const from = ctx.from;
  if (!from) return 'prompted';

  const next = await getNextMissingChoiceField(config, from.id);
  if (!next) return 'ready';

  const profile = await getProfile(config, from.id);
  const skipPrompt =
    userText === '你好，我剛開始使用 SweetBonb。' || userText === WELCOME_AFTER_LANGUAGE;

  if (
    !skipPrompt &&
    (await tryApplyChoiceFromText(ctx, config, from.id, next.field, next.options, userText))
  ) {
    return 'just_set';
  }

  if (!skipPrompt && userText.trim()) {
    const lang = profile?.preferred_language ?? null;
    const en = lang === 'en';
    await ctx.reply(
      en
        ? `Please choose an option for "${next.field.label_zh}":`
        : `請用下面按鈕選擇「${next.field.label_zh}」：`,
    );
  }

  await sendFieldChoicePicker(ctx, from.id, next.field, next.options, profile?.preferred_language ?? null);
  return 'prompted';
}
