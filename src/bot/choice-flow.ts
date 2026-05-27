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
} from './questionnaire-order.js';
import { logInfo } from '../ops/runtime-log.js';
import {
  GENDER_OPTIONS,
  genderLabel,
  getFieldOptionsForUser,
  fieldHasChoiceOptions,
  isTargetRelationshipChoiceAllowed,
  matchChoiceFieldOption,
  parseGenderInput,
  TARGET_RELATIONSHIP_LONG_TERM,
} from './field-choices.js';
import { getPostResponseMap } from '../db/post-fields.js';
import { deleteMessageSafe } from './language-flow.js';
import { WELCOME_AFTER_LANGUAGE } from './commands.js';
import {
  buildQuestionnaireIntro,
  buildQuestionnairePrompt,
  formatUserAnswerLog,
  type SavedFieldAnswer,
} from './questionnaire-copy.js';
import {
  logQuestionnaireBotPrompt,
  logQuestionnaireUserAnswer,
  type QuestionnaireLogContext,
} from './questionnaire-log.js';
import {
  clearQuestionPrompt,
  markQuestionPrompted,
  wasQuestionPrompted,
} from './questionnaire-prompt.js';

export { getFieldOptions, fieldHasChoiceOptions } from './field-choices.js';
export type { SavedFieldAnswer } from './questionnaire-copy.js';
export type { QuestionnaireLogContext } from './questionnaire-log.js';

export interface QuestionnaireStepOptions {
  previous?: SavedFieldAnswer;
  log?: QuestionnaireLogContext;
  includeIntro?: boolean;
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
  messageText?: string,
): Promise<void> {
  const text =
    messageText ??
    buildQuestionnairePrompt(field, lang, { hasChoiceOptions: true });
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
  messageText?: string,
): Promise<void> {
  const text = messageText ?? buildQuestionnairePrompt(field, lang, { hasChoiceOptions: false });
  await ctx.reply(text);
  markQuestionPrompted(userId, field.field_key, 'text');
}

async function promptNextQuestionnaireField(
  ctx: Context,
  config: AppConfig,
  userId: number,
  step?: QuestionnaireStepOptions,
): Promise<'prompted' | 'complete' | 'idle'> {
  const profile = await getProfile(config, userId);
  const lang = profile?.preferred_language ?? null;
  const next = await getNextMissingQuestionnaireField(config, userId);
  if (!next) {
    const { complete } = await checkPostResponsesComplete(config, userId);
    if (complete) {
      clearQuestionPrompt(userId);
      await resolveUserStage(config, userId);
      return 'complete';
    }
    logInfo('questionnaire', 'No next field but questionnaire incomplete', { userId });
    return 'idle';
  }

  if (next.field.field_key === 'acceptance_questionnaire') {
    const { startAcceptanceQuestionnaire } = await import('./acceptance-flow.js');
    await startAcceptanceQuestionnaire(ctx, config, userId, {
      previous: step?.previous,
      lang,
      log: step?.log,
    });
    return 'prompted';
  }

  if (wasQuestionPrompted(userId, next.field.field_key)) return 'idle';

  let text = buildQuestionnairePrompt(next.field, lang, {
    previous: step?.includeIntro ? undefined : step?.previous,
    hasChoiceOptions: Boolean(next.options?.length),
  });

  if (step?.includeIntro) {
    const { needsUsernameReminder } = await import('../db/profile.js');
    const intro = buildQuestionnaireIntro(lang, needsUsernameReminder(profile));
    const question = buildQuestionnairePrompt(next.field, lang, {
      previous: step?.previous,
      hasChoiceOptions: Boolean(next.options?.length),
    });
    text = `${intro}\n\n${question}`;
  }

  if (next.options?.length) {
    await sendFieldChoicePicker(ctx, userId, next.field, next.options, lang, text);
  } else {
    await sendTextFieldPrompt(ctx, userId, next.field, lang, text);
  }

  if (step?.log) {
    await logQuestionnaireBotPrompt(step.log, text);
  }
  return 'prompted';
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
): Promise<SavedFieldAnswer | null> {
  const value = resolveChoiceIndex(userId, fieldKey, index);
  if (!value) {
    await ctx.answerCallbackQuery({ text: '選項已過期，請重新選擇' });
    return null;
  }

  const defs = await getPostFieldDefs(config);
  const field = defs.find((d) => d.field_key === fieldKey);
  const postData = await getPostResponseMap(config, userId);

  if (
    fieldKey === 'target_relationship' &&
    !isTargetRelationshipChoiceAllowed(postData.member_relationship_status, value)
  ) {
    await ctx.answerCallbackQuery({ text: '「情侶-長遠發展」只限單身用戶' });
    return null;
  }

  await savePostResponse(config, userId, fieldKey, value);
  clearQuestionPrompt(userId, fieldKey);
  await resolveUserStage(config, userId);
  logInfo('post', 'Choice field set from button', { userId, field: fieldKey, value });

  if (
    fieldKey === 'member_relationship_status' &&
    value !== '單身' &&
    postData.target_relationship === TARGET_RELATIONSHIP_LONG_TERM
  ) {
    await savePostResponse(config, userId, 'target_relationship', '');
  }

  const callbackMessage = ctx.callbackQuery?.message;
  if (callbackMessage) {
    await deleteMessageSafe(ctx.api, callbackMessage.chat.id, callbackMessage.message_id);
  }

  await ctx.answerCallbackQuery({ text: `已選擇：${value}` });
  return {
    fieldKey,
    label: field?.label_zh ?? fieldKey,
    value,
  };
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
): Promise<SavedFieldAnswer | null> {
  const skipPrompt =
    text === '你好，我剛開始使用 SweetBonb。' || text === WELCOME_AFTER_LANGUAGE;
  if (skipPrompt || !text.trim()) return null;

  const defs = await getPostFieldDefs(config);
  const { missing } = await checkPostResponsesComplete(config, userId);
  const missingSet = new Set(missing);

  for (const field of defs) {
    if (!missingSet.has(field.field_key) || !fieldHasChoiceOptions(field)) continue;
    const options = await getFieldOptionsForUser(config, userId, field);
    const matched = matchChoiceFieldOption(field.field_key, options, text);
    if (!matched) continue;

    if (
      field.field_key === 'target_relationship' &&
      matched === TARGET_RELATIONSHIP_LONG_TERM
    ) {
      const data = await getPostResponseMap(config, userId);
      if (!isTargetRelationshipChoiceAllowed(data.member_relationship_status, matched)) {
        continue;
      }
    }

    await savePostResponse(config, userId, field.field_key, matched);
    clearQuestionPrompt(userId, field.field_key);
    await resolveUserStage(config, userId);
    logInfo('post', 'Choice field set from text', {
      userId,
      field: field.field_key,
      value: matched,
    });
    return { fieldKey: field.field_key, label: field.label_zh, value: matched };
  }
  return null;
}

export async function tryApplyTextFieldFromText(
  ctx: Context,
  config: AppConfig,
  userId: number,
  text: string,
): Promise<SavedFieldAnswer | null> {
  const skipPrompt =
    text === '你好，我剛開始使用 SweetBonb。' || text === WELCOME_AFTER_LANGUAGE;
  if (skipPrompt || !text.trim()) return null;

  const next = await getNextMissingQuestionnaireField(config, userId);
  if (!next || next.options?.length) return null;
  if (next.field.field_key === 'acceptance_questionnaire') return null;

  const value = text.trim();
  if (!value) return null;

  await savePostResponse(config, userId, next.field.field_key, value);
  clearQuestionPrompt(userId, next.field.field_key);
  await resolveUserStage(config, userId);
  logInfo('post', 'Text field set from message', {
    userId,
    field: next.field.field_key,
    value: value.slice(0, 80),
  });
  return { fieldKey: next.field.field_key, label: next.field.label_zh, value };
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
  step?: QuestionnaireStepOptions,
): Promise<void> {
  await promptNextQuestionnaireField(ctx, config, userId, step);
}

/** Advance to the next questionnaire step after an answer is saved. */
export async function continueQuestionnaireStep(
  ctx: Context,
  config: AppConfig,
  userId: number,
  step?: QuestionnaireStepOptions,
): Promise<'prompted' | 'complete' | 'idle'> {
  return promptNextQuestionnaireField(ctx, config, userId, step);
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
  step?: Pick<QuestionnaireStepOptions, 'log'>,
): Promise<'ready' | 'handled' | 'waiting' | 'complete'> {
  const { hasAcceptanceInProgress } = await import('./acceptance-flow.js');
  if (hasAcceptanceInProgress(userId)) return 'ready';

  const stage = await resolveUserStage(config, userId);
  if (stage !== 'profile_complete' && stage !== 'post_ready') return 'ready';

  const { complete } = await checkPostResponsesComplete(config, userId);
  if (complete) return 'ready';

  if (!isSyntheticUserText(userText) && userText.trim()) {
    const savedChoice = await tryApplyAnyMissingChoiceFromText(ctx, config, userId, userText);
    if (savedChoice) {
      if (step?.log) {
        await logQuestionnaireUserAnswer(step.log, formatUserAnswerLog(savedChoice));
      }
      const result = await continueQuestionnaireStep(ctx, config, userId, {
        previous: savedChoice,
        log: step?.log,
      });
      return result === 'complete' ? 'complete' : 'handled';
    }
    const savedText = await tryApplyTextFieldFromText(ctx, config, userId, userText);
    if (savedText) {
      if (step?.log) {
        await logQuestionnaireUserAnswer(step.log, formatUserAnswerLog(savedText));
      }
      const result = await continueQuestionnaireStep(ctx, config, userId, {
        previous: savedText,
        log: step?.log,
      });
      return result === 'complete' ? 'complete' : 'handled';
    }
  }

  const next = await getNextMissingQuestionnaireField(config, userId);
  if (!next) return 'ready';

  if (wasQuestionPrompted(userId, next.field.field_key)) {
    if (!isSyntheticUserText(userText) && userText.trim()) {
      const profile = await getProfile(config, userId);
      const en = profile?.preferred_language === 'en';
      const hint = next.options?.length
        ? en
          ? 'Please use the buttons above to choose.'
          : '請用上面嘅按鈕選擇～'
        : en
          ? `Please reply with: ${next.field.label_zh}`
          : `直接回覆「${next.field.label_zh}」就可以～`;
      await ctx.reply(hint);
      if (step?.log) await logQuestionnaireBotPrompt(step.log, hint);
    }
    return 'waiting';
  }

  await promptNextQuestionnaireField(ctx, config, userId, step);
  return 'waiting';
}

export async function beginQuestionnaire(
  ctx: Context,
  config: AppConfig,
  userId: number,
  step?: Pick<QuestionnaireStepOptions, 'log' | 'previous'>,
): Promise<void> {
  clearQuestionPrompt(userId);
  await promptNextQuestionnaireField(ctx, config, userId, {
    includeIntro: true,
    log: step?.log,
    previous: step?.previous,
  });
}
