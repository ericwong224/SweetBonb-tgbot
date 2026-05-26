import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { AppConfig } from '../config.js';
import { getProfile, setPreferredLanguage } from '../db/profile.js';
import { getUserPost } from '../db/user-post.js';
import { resolveUserStage } from '../flow/stages.js';
import {
  getLanguageLabel,
  helpMessage,
  LANGUAGE_OPTIONS,
  LANGUAGE_PICK_MESSAGE,
  languageSavedMessage,
  type UserLanguage,
} from '../i18n/language.js';
import { logInfo } from '../ops/runtime-log.js';
import type { BotInfo } from '../db/bots.js';

export function languageKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const opt of LANGUAGE_OPTIONS) {
    kb.text(opt.label, `lang:${opt.code}`).row();
  }
  return kb;
}

export async function sendLanguagePicker(ctx: Context): Promise<void> {
  await ctx.reply(LANGUAGE_PICK_MESSAGE, { reply_markup: languageKeyboard() });
}

export async function applyLanguageChoice(
  ctx: Context,
  config: AppConfig,
  lang: UserLanguage,
  botInfo: BotInfo,
): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  await setPreferredLanguage(config, from.id, lang);
  logInfo('language', 'User set language', {
    userId: from.id,
    lang,
    bot: botInfo.bot_username,
  });
  await ctx.reply(languageSavedMessage(lang));
}

export async function handleHelpCommand(ctx: Context, config: AppConfig): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  const profile = await getProfile(config, from.id);
  logInfo('command', '/help', { userId: from.id });
  await ctx.reply(helpMessage(profile?.preferred_language ?? null));
}

export async function handleStatusCommand(
  ctx: Context,
  config: AppConfig,
  botInfo: BotInfo,
): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const profile = await getProfile(config, from.id);
  const stage = await resolveUserStage(config, from.id);
  const post = await getUserPost(config, from.id);
  const lang = profile?.preferred_language ?? null;

  logInfo('command', '/status', { userId: from.id, stage });

  if (lang === 'en') {
    await ctx.reply(
      `Stage: ${stage}\nLanguage: ${getLanguageLabel(lang)}\nPost: ${post?.status ?? 'draft'}`,
    );
    return;
  }

  const formal = lang === 'zh-written';
  await ctx.reply(
    formal
      ? `流程階段：${stage}\n語言：${getLanguageLabel(lang)}\n啟示狀態：${post?.status ?? 'draft'}`
      : `而家階段：${stage}\n語言：${getLanguageLabel(lang)}\n啟示狀態：${post?.status ?? 'draft'}`,
  );
}

export async function registerBotCommands(api: { setMyCommands: (cmds: Array<{ command: string; description: string }>) => Promise<boolean> }): Promise<void> {
  await api.setMyCommands([
    { command: 'start', description: '開始 / Start' },
    { command: 'help', description: '指令說明 / Help' },
    { command: 'language', description: '選擇語言 / Language' },
    { command: 'status', description: '查看進度 / Status' },
  ]);
}
