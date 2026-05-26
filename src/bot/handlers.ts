import type { Context } from 'grammy';
import type { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import { buildChatSystemPrompt } from '../ai/system-prompt.js';
import { runAgent, runMatchAnalysis } from '../ai/deepseek.js';
import { userFacingAiError, formatErrorMessage } from '../ai/health.js';
import { formatAdminErrorAlert, notifyAdminThrottled } from './admin-notify.js';
import {
  applyFieldChoice,
  applyGenderChoice,
  ensureGenderOrPrompt,
  ensurePostChoiceOrPrompt,
  matchReplyKeyboard,
  sendFollowUpPickers,
} from './choice-flow.js';
import {
  applyAcceptanceChoice,
  ensureAcceptanceOrPrompt,
  hasAcceptanceInProgress,
} from './acceptance-flow.js';
import {
  applyLocationChoice,
  sendNextCoreProfilePromptIfNeeded,
  sendUsernameReminderIfNeeded,
  shouldSendCoreProfileFollowUp,
  tryApplyCoreProfileFromText,
} from './profile-flow.js';
import { getLatestSystemPrompt } from '../db/agents.js';
import { getMatch, setMatchTargetMessageId, updateMatchStatus } from '../db/matches.js';
import { getChatHistory, logMessage } from '../db/messages.js';
import { checkPostResponsesComplete } from '../db/post-fields.js';
import { getProfile, isProfileComplete, upsertProfileFromTelegram } from '../db/profile.js';
import {
  createTgMatch,
  findExistingTgMatch,
  getTgMatch,
  setTgMatchTargetMessageId,
  updateTgMatchStatus,
} from '../db/tg-match.js';
import { getUserPost, isPostPublished } from '../db/user-post.js';
import { getUser, isUserBlocked } from '../db/users.js';
import { resolveUserStage, toolsForStage } from '../flow/stages.js';
import type { ToolContext } from '../tools/handlers.js';
import {
  normalizeMatchResult,
  parseMatchStart,
  parseMatchTargetStart,
  splitTelegramMessage,
  stripMarkdown,
} from '../utils/text.js';
import type { BotInfo } from '../db/bots.js';
import {
  applyLanguageChoice,
  handleHelpCommand,
  handleStatusCommand,
  sendLanguagePicker,
  WELCOME_AFTER_LANGUAGE,
} from './commands.js';
import { userMessageLock } from './user-lock.js';
import {
  needsLanguageSelection,
  parseLanguageInput,
  type UserLanguage,
} from '../i18n/language.js';
import { logInfo, logWarn, logError } from '../ops/runtime-log.js';

export interface AppContext {
  config: AppConfig;
  botInfo: BotInfo;
}

const BLOCKED_USER_MESSAGE = '不好意思!\n您的活動已被封鎖，請聯絡 @sexycandyhk';
const WAIT_MESSAGE = '請稍後';

export function registerHandlers(bot: Bot, app: AppContext) {
  const toolContext = (userId?: number, stage?: Awaited<ReturnType<typeof resolveUserStage>>): ToolContext => ({
    config: app.config,
    api: bot.api,
    userId,
    botUsername: app.botInfo.bot_username,
    userStage: stage,
  });

  if (app.config.TEST_MESSAGE_ACK) {
    console.warn('TEST_MESSAGE_ACK enabled: replying 收到 to all text messages');
  }

  bot.command('start', async (ctx) => {
    await withUserLock(ctx, app, async () => {
      if (app.config.TEST_MESSAGE_ACK) {
        await ctx.reply('收到');
        return;
      }

      const text = ctx.message?.text ?? '/start';
      const targetUserId = parseMatchTargetStart(text);
      if (targetUserId) {
        await handleMatchFromChannel(ctx, app, targetUserId);
        return;
      }

      const matchId = parseMatchStart(text);
      if (matchId) {
        await handleMatchStart(ctx, app, matchId);
        return;
      }

      await syncUser(ctx, app.config);

      const langState = await ensureLanguageOrPrompt(ctx, app.config, '', app.botInfo);
      if (langState === 'prompted') return;

      await handleChat(
        ctx,
        app,
        toolContext(ctx.from?.id),
        WELCOME_AFTER_LANGUAGE,
        { skipLanguageCheck: true },
      );
    });
  });

  bot.command(['help', 'language', 'lang', 'status'], async (ctx) => {
    await withUserLock(ctx, app, async () => {
      if (app.config.TEST_MESSAGE_ACK) {
        await ctx.reply('收到');
        return;
      }
      await syncUser(ctx, app.config);
      const cmd = (ctx.message?.text ?? '').trim().split(/\s+/)[0]?.replace(/@\w+$/, '').slice(1);
      logInfo('command', `/${cmd ?? 'unknown'}`, { userId: ctx.from?.id });

      if (cmd === 'help') {
        await handleHelpCommand(ctx, app.config);
        return;
      }
      if (cmd === 'status') {
        await handleStatusCommand(ctx, app.config, app.botInfo);
        return;
      }
      await sendLanguagePicker(ctx);
    });
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith('lang:')) {
      const lang = data.slice(5) as UserLanguage;
      if (!['zh-spoken', 'zh-written', 'en'].includes(lang)) {
        await ctx.answerCallbackQuery({ text: 'Invalid language' });
        return;
      }

      await withUserLock(ctx, app, async () => {
        await syncUser(ctx, app.config);
        await applyLanguageChoice(ctx, app.config, lang, app.botInfo);
        await handleChat(
          ctx,
          app,
          toolContext(ctx.from?.id),
          WELCOME_AFTER_LANGUAGE,
          { skipLanguageCheck: true },
        );
      });
      return;
    }

    if (data.startsWith('loc:')) {
      const index = Number(data.slice(4));
      if (Number.isNaN(index)) {
        await ctx.answerCallbackQuery({ text: 'Invalid option' });
        return;
      }

      await withUserLock(ctx, app, async () => {
        const from = ctx.from;
        if (!from) return;
        await syncUser(ctx, app.config);
        const ok = await applyLocationChoice(ctx, app.config, from.id, index);
        if (!ok) return;
        await handleChat(
          ctx,
          app,
          toolContext(from.id),
          WELCOME_AFTER_LANGUAGE,
          {
            skipLanguageCheck: true,
            skipGenderCheck: true,
            skipPostChoiceCheck: true,
            skipAcceptanceCheck: true,
          },
        );
      });
      return;
    }

    if (data.startsWith('gender:')) {
      const value = data.slice(7);
      if (value !== 'M' && value !== 'F') {
        await ctx.answerCallbackQuery({ text: 'Invalid option' });
        return;
      }

      await withUserLock(ctx, app, async () => {
        const from = ctx.from;
        if (!from) return;
        await syncUser(ctx, app.config);
        await applyGenderChoice(ctx, app.config, from.id, value);
        await handleChat(
          ctx,
          app,
          toolContext(from.id),
          WELCOME_AFTER_LANGUAGE,
          { skipLanguageCheck: true, skipGenderCheck: true },
        );
      });
      return;
    }

    if (data.startsWith('pick:')) {
      const parts = data.split(':');
      const fieldKey = parts[1];
      const index = Number(parts[2]);
      if (!fieldKey || Number.isNaN(index)) {
        await ctx.answerCallbackQuery({ text: 'Invalid option' });
        return;
      }

      await withUserLock(ctx, app, async () => {
        const from = ctx.from;
        if (!from) return;
        await syncUser(ctx, app.config);
        const ok = await applyFieldChoice(ctx, app.config, from.id, fieldKey, index);
        if (!ok) return;
        await handleChat(
          ctx,
          app,
          toolContext(from.id),
          WELCOME_AFTER_LANGUAGE,
          {
            skipLanguageCheck: true,
            skipGenderCheck: true,
            skipPostChoiceCheck: true,
            skipAcceptanceCheck: true,
          },
        );
      });
      return;
    }

    if (data.startsWith('acc:')) {
      const parts = data.split(':');
      const itemIndex = Number(parts[1]);
      const levelIndex = Number(parts[2]);
      if (Number.isNaN(itemIndex) || Number.isNaN(levelIndex)) {
        await ctx.answerCallbackQuery({ text: 'Invalid option' });
        return;
      }

      await withUserLock(ctx, app, async () => {
        const from = ctx.from;
        if (!from) return;
        await syncUser(ctx, app.config);
        const result = await applyAcceptanceChoice(
          ctx,
          app.config,
          from.id,
          itemIndex,
          levelIndex,
        );
        if (result === 'complete') {
          await handleChat(
            ctx,
            app,
            toolContext(from.id),
            WELCOME_AFTER_LANGUAGE,
            {
              skipLanguageCheck: true,
              skipGenderCheck: true,
              skipPostChoiceCheck: true,
              skipAcceptanceCheck: true,
            },
          );
        }
      });
      return;
    }

    if (data === 'match:accept' || data === 'match:reject') {
      await withUserLock(ctx, app, async () => {
        const from = ctx.from;
        if (!from) return;
        await ctx.answerCallbackQuery({
          text: data === 'match:accept' ? '已接受' : '已拒絕',
        });
        const callbackMessage = ctx.callbackQuery?.message;
        if (callbackMessage) {
          await ctx.api
            .deleteMessage(callbackMessage.chat.id, callbackMessage.message_id)
            .catch(() => undefined);
        }
        await handleMatchReply(ctx, app, data === 'match:accept' ? 'accept' : 'reject');
      });
      return;
    }
  });

  bot.on('message:text', async (ctx) => {
    await withUserLock(ctx, app, async () => {
      if (app.config.TEST_MESSAGE_ACK) {
        await ctx.reply('收到');
        return;
      }
      if (ctx.message.text.startsWith('/')) return;
      await handleChat(ctx, app, toolContext(ctx.from?.id), ctx.message.text);
    });
  });
}

async function withUserLock(
  ctx: Context,
  app: AppContext,
  handler: () => Promise<void>,
): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  if (!userMessageLock.tryAcquire(from.id)) {
    const chatId = ctx.chat?.id;
    const messageId = ctx.message?.message_id;
    logWarn('lock', 'Message ignored — user busy', { userId: from.id, messageId });
    if (chatId != null && messageId != null) {
      await ctx.api.deleteMessage(chatId, messageId).catch(() => undefined);
    }
    if (userMessageLock.shouldNotifyWait(from.id)) {
      await ctx.reply(WAIT_MESSAGE).catch(() => undefined);
      userMessageLock.markWaitNotified(from.id);
    }
    return;
  }

  try {
    await handler();
  } finally {
    userMessageLock.release(from.id);
  }
}

async function syncUser(ctx: Context, config: AppConfig) {
  const from = ctx.from;
  if (!from) return;

  await upsertProfileFromTelegram(config, {
    userId: from.id,
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });
}

async function handleMatchFromChannel(
  ctx: Context,
  app: AppContext,
  targetUserId: number,
) {
  await syncUser(ctx, app.config);
  const from = ctx.from;
  if (!from) return;

  if (from.id === targetUserId) {
    await ctx.reply('這是你自己的啟示，無法與自己配對。');
    return;
  }

  const initiatorProfile = await getProfile(app.config, from.id);
  const targetProfile = await getProfile(app.config, targetUserId);

  if (!isProfileComplete(initiatorProfile)) {
    await ctx.reply('請先完成基本資料，才能發起配對。');
    return;
  }

  const initiatorPost = await getUserPost(app.config, from.id);
  if (!isPostPublished(initiatorPost)) {
    await ctx.reply('請先發佈你的啟示，才能向他人發起配對。');
    return;
  }

  if (!isProfileComplete(targetProfile)) {
    await ctx.reply('對方資料不完整，暫時無法配對。');
    return;
  }

  const targetPost = await getUserPost(app.config, targetUserId);
  if (!isPostPublished(targetPost)) {
    await ctx.reply('對方的啟示尚未發佈，暫時無法配對。');
    return;
  }

  const existing = await findExistingTgMatch(app.config, from.id, targetUserId);
  if (existing) {
    await ctx.reply('你已經向這位用戶發起過配對請求，請等待回覆。');
    return;
  }

  const initiatorSnapshot = initiatorPost?.body_format ?? '';
  const targetSnapshot = targetPost?.body_format ?? '';
  const matchId = await createTgMatch(
    app.config,
    from.id,
    targetUserId,
    initiatorSnapshot,
    targetSnapshot,
  );

  const systemPrompt = await getLatestSystemPrompt(app.config, 'sb-match');
  const analysis = await runMatchAnalysis(
    app.config,
    systemPrompt,
    initiatorSnapshot,
    targetSnapshot,
  );

  const result = normalizeMatchResult(analysis);
  const matchRate = result === 'match' ? 85 : 40;

  if (result === 'match') {
    await updateTgMatchStatus(
      app.config,
      matchId,
      'Waiting-for-reply',
      analysis,
      matchRate,
    );
    await ctx.reply('配對分析：匹配。系統已通知對方，請等待回覆。');
  } else {
    await updateTgMatchStatus(
      app.config,
      matchId,
      'Inappropriate',
      analysis,
      matchRate,
    );
    await ctx.reply('配對分析：不匹配。');
  }

  await logMessage(app.config, {
    userId: from.id,
    username: from.username,
    botHandle: app.botInfo.bot_username,
    msgType: 'match-request',
    msgContent: analysis,
    chatId: ctx.chat?.id,
    messageId: ctx.message?.message_id,
    agentKey: 'sb-match',
  });
}

async function handleMatchStart(ctx: Context, app: AppContext, matchId: number) {
  await syncUser(ctx, app.config);
  const from = ctx.from;
  if (!from) return;

  const tgMatch = await getTgMatch(app.config, matchId);
  if (tgMatch) {
    if (tgMatch.target_id !== from.id && tgMatch.initiator_id !== from.id) {
      await ctx.reply('這個配對請求不屬於你。');
      return;
    }

    const systemPrompt = await getLatestSystemPrompt(app.config, 'sb-match');
    const analysis = await runMatchAnalysis(
      app.config,
      systemPrompt,
      tgMatch.initiator_snapshot ?? '',
      tgMatch.target_snapshot ?? '',
    );

    const result = normalizeMatchResult(analysis);
    const matchRate = result === 'match' ? 85 : 40;

    if (result === 'match') {
      await updateTgMatchStatus(
        app.config,
        matchId,
        'Waiting-for-reply',
        analysis,
        matchRate,
      );

      if (tgMatch.target_id === from.id) {
        const reply = `你收到一個配對請求：\n\n${tgMatch.initiator_snapshot ?? ''}\n\n是否接受這個配對？`;
        const sent = await ctx.reply(reply, { reply_markup: matchReplyKeyboard() });
        await setTgMatchTargetMessageId(app.config, matchId, sent.message_id);
      } else {
        await ctx.reply('配對分析：匹配。系統已向对方發出請求，請等待回覆。');
      }
    } else {
      await updateTgMatchStatus(
        app.config,
        matchId,
        'Inappropriate',
        analysis,
        matchRate,
      );
      await ctx.reply('配對分析：不匹配。');
    }

    await logMessage(app.config, {
      userId: from.id,
      username: from.username,
      botHandle: app.botInfo.bot_username,
      msgType: 'match-request',
      msgContent: analysis,
      chatId: ctx.chat?.id,
      messageId: ctx.message?.message_id,
      agentKey: 'sb-match',
    });
    return;
  }

  const match = await getMatch(app.config, matchId);
  if (!match) {
    await ctx.reply('找不到這個配對請求。');
    return;
  }

  if (match.target_id !== from.id && match.initiator_id !== from.id) {
    await ctx.reply('這個配對請求不屬於你。');
    return;
  }

  const systemPrompt = await getLatestSystemPrompt(app.config, 'sb-match');
  const analysis = await runMatchAnalysis(
    app.config,
    systemPrompt,
    match.initiator_data ?? '',
    match.target_data ?? '',
  );

  const result = normalizeMatchResult(analysis);
  const matchRate = result === 'match' ? 85 : 40;

  if (result === 'match') {
    await updateMatchStatus(app.config, matchId, 'Waiting-for-reply', analysis, matchRate);

    if (match.target_id === from.id) {
      const reply = `你收到一個配對請求：\n\n${match.initiator_data ?? ''}\n\n是否接受這個配對？`;
      const sent = await ctx.reply(reply, { reply_markup: matchReplyKeyboard() });
      await setMatchTargetMessageId(app.config, matchId, sent.message_id);
    } else {
      await ctx.reply('配對分析：匹配。系統已向对方發出請求，請等待回覆。');
    }
  } else {
    await updateMatchStatus(app.config, matchId, 'Inappropriate', analysis, matchRate);
    await ctx.reply('配對分析：不匹配。');
  }

  await logMessage(app.config, {
    userId: from.id,
    username: from.username,
    botHandle: app.botInfo.bot_username,
    msgType: 'match-request',
    msgContent: analysis,
    chatId: ctx.chat?.id,
    messageId: ctx.message?.message_id,
    agentKey: 'sb-match',
  });
}

async function ensureLanguageOrPrompt(
  ctx: Context,
  config: AppConfig,
  userText: string,
  botInfo: BotInfo,
): Promise<'ready' | 'prompted' | 'just_set'> {
  const from = ctx.from;
  if (!from) return 'prompted';

  const profile = await getProfile(config, from.id);
  if (!needsLanguageSelection(profile)) return 'ready';

  const parsed = parseLanguageInput(userText);
  if (parsed) {
    await applyLanguageChoice(ctx, config, parsed, botInfo);
    return 'just_set';
  }

  await sendLanguagePicker(ctx);
  return 'prompted';
}

async function handleChat(
  ctx: Context,
  app: AppContext,
  toolCtx: ToolContext,
  userText: string,
  options?: {
    skipLanguageCheck?: boolean;
    skipGenderCheck?: boolean;
    skipPostChoiceCheck?: boolean;
    skipAcceptanceCheck?: boolean;
  },
) {
  await syncUser(ctx, app.config);
  const from = ctx.from;
  if (!from) return;

  if (!options?.skipLanguageCheck) {
    const langState = await ensureLanguageOrPrompt(ctx, app.config, userText, app.botInfo);
    if (langState === 'prompted') return;
    if (langState === 'just_set') {
      userText = WELCOME_AFTER_LANGUAGE;
    }
  }

  const profileEarly = await getProfile(app.config, from.id);
  if (!options?.skipGenderCheck && !profileEarly?.gender) {
    const genderState = await ensureGenderOrPrompt(ctx, app.config, userText);
    if (genderState === 'prompted') return;
    if (genderState === 'just_set') {
      userText = WELCOME_AFTER_LANGUAGE;
    }
  }

  if (!options?.skipPostChoiceCheck) {
    const choiceState = await ensurePostChoiceOrPrompt(ctx, app.config, userText);
    if (choiceState === 'just_set') {
      userText = WELCOME_AFTER_LANGUAGE;
    }
  }

  if (!options?.skipAcceptanceCheck && from && hasAcceptanceInProgress(from.id)) {
    const accState = await ensureAcceptanceOrPrompt(ctx, app.config, userText);
    if (accState === 'prompted') return;
    if (accState === 'just_set') {
      userText = WELCOME_AFTER_LANGUAGE;
    }
  }

  if (await tryApplyCoreProfileFromText(ctx, app.config, from.id, userText)) {
    userText = WELCOME_AFTER_LANGUAGE;
  }

  logInfo('message', 'Incoming user message', {
    userId: from.id,
    username: from.username,
    preview: userText.slice(0, 120),
  });

  const user = await getUser(app.config, from.id);

  if (isUserBlocked(user)) {
    await ctx.reply(BLOCKED_USER_MESSAGE);
    await logMessage(app.config, {
      userId: from.id,
      username: from.username,
      botHandle: app.botInfo.bot_username,
      msgType: 'send-ai-reply',
      msgContent: BLOCKED_USER_MESSAGE,
      chatId: ctx.chat?.id,
    });
    return;
  }

  const acceptReject = userText.trim();
  if (acceptReject === '接受' || acceptReject === '拒絕') {
    await handleMatchReply(ctx, app, acceptReject === '接受' ? 'accept' : 'reject');
    return;
  }

  const isAdmin = from.id === app.botInfo.bot_admin_id;
  const agentFunction = isAdmin && userText.startsWith('/admin') ? 'sb-admin' : 'sb-main';
  const cleanText = userText.replace(/^\/admin\s*/, '');

  const stage = await resolveUserStage(app.config, from.id);
  const profile = await getProfile(app.config, from.id);
  const userPost = await getUserPost(app.config, from.id);
  const postCheck = await checkPostResponsesComplete(app.config, from.id);

  await logMessage(app.config, {
    userId: from.id,
    username: from.username,
    gender: user?.gender ?? null,
    botHandle: app.botInfo.bot_username,
    msgType: 'incoming-msg',
    msgContent: cleanText,
    chatId: ctx.chat?.id,
    messageId: ctx.message?.message_id,
    stageKey: stage,
    agentKey: agentFunction,
  });

  await ctx.api.sendChatAction(from.id, 'typing');

  const basePrompt = await getLatestSystemPrompt(app.config, agentFunction, stage);
  if (!basePrompt.trim()) {
    const err = 'Empty system prompt from database';
    logError('ai', err, { userId: from.id, agentFunction, stage });
    await notifyAdminThrottled(
      ctx.api,
      app.botInfo.bot_admin_id,
      'ai:empty-prompt',
      formatAdminErrorAlert({
        category: 'AI / empty prompt',
        error: err,
        bot: app.botInfo.bot_username,
        mode: app.config.BOT_MODE,
        userId: from.id,
        username: from.username,
        stage,
        userMessage: cleanText,
      }),
    );
    await ctx.reply(userFacingAiError(profile?.preferred_language));
    return;
  }

  const systemPrompt = buildChatSystemPrompt({
    basePrompt,
    agentFunction,
    profile,
    stage,
    postStatus: userPost?.status ?? 'draft',
    missingPostFields: postCheck.missing,
    preferredLanguage: profile?.preferred_language ?? null,
  });

  const history = await getChatHistory(
    app.config,
    from.id,
    app.botInfo.bot_username,
    app.config.CHAT_HISTORY_LIMIT,
  );

  const allowedToolNames =
    agentFunction === 'sb-main' ? toolsForStage(stage) : undefined;

  let reply: string;
  try {
    reply = await runAgent({
      config: app.config,
      toolContext: { ...toolCtx, userId: from.id, userStage: stage },
      systemPrompt,
      userMessage: cleanText,
      history,
      toolsEnabled: agentFunction === 'sb-main',
      allowedToolNames,
      maxIterations: app.config.AGENT_MAX_ITERATIONS,
    });
  } catch (error) {
    const errMsg = formatErrorMessage(error);
    logError('ai', 'Agent failed', {
      userId: from.id,
      error: errMsg,
    });
    console.error('AI agent error:', error);
    await notifyAdminThrottled(
      ctx.api,
      app.botInfo.bot_admin_id,
      `ai:${errMsg.slice(0, 80)}`,
      formatAdminErrorAlert({
        category: 'AI / agent',
        error: errMsg,
        bot: app.botInfo.bot_username,
        mode: app.config.BOT_MODE,
        userId: from.id,
        username: from.username,
        stage,
        userMessage: cleanText,
      }),
    );
    reply = userFacingAiError(profile?.preferred_language);
  }

  logInfo('message', 'AI reply sent', {
    userId: from.id,
    stage,
    preview: reply.slice(0, 120),
  });

  let lastMessageId: number | undefined;
  const plainReply = stripMarkdown(reply);
  for (const chunk of splitTelegramMessage(plainReply)) {
    const sent = await ctx.reply(chunk);
    lastMessageId = sent.message_id;
  }

  await logMessage(app.config, {
    userId: from.id,
    username: from.username,
    gender: user?.gender ?? null,
    botHandle: app.botInfo.bot_username,
    msgType: 'send-ai-reply',
    msgContent: plainReply,
    chatId: ctx.chat?.id,
    messageId: lastMessageId,
    stageKey: stage,
    agentKey: agentFunction,
  });

  if (agentFunction === 'sb-main') {
    if (shouldSendCoreProfileFollowUp(stage, profile, plainReply)) {
      await sendNextCoreProfilePromptIfNeeded(ctx, app.config, from.id);
    }
    await sendFollowUpPickers(ctx, app.config, from.id);
    await sendUsernameReminderIfNeeded(ctx, app.config, from.id);
  }
}

async function handleMatchReply(ctx: Context, app: AppContext, action: 'accept' | 'reject') {
  const from = ctx.from;
  if (!from) return;

  const stage = await resolveUserStage(app.config, from.id);
  const { executeTool } = await import('../tools/handlers.js');
  const toolCtx: ToolContext = {
    config: app.config,
    api: ctx.api,
    userId: from.id,
    botUsername: app.botInfo.bot_username,
    userStage: stage,
  };
  const pending = await executeTool(toolCtx, 'match_request', { user_id: from.id });

  if (!Array.isArray(pending) || pending.length === 0) {
    await ctx.reply('目前沒有待處理的配對請求。');
    return;
  }

  const latest = pending[0] as { match_id: number };
  await executeTool(toolCtx, 'match_reply', { match_id: latest.match_id, action });

  await ctx.reply(action === 'accept' ? '已接受配對請求。' : '已拒絕配對請求。');

  await logMessage(app.config, {
    userId: from.id,
    username: from.username,
    botHandle: app.botInfo.bot_username,
    msgType: 'match-msg',
    msgContent: action,
    chatId: ctx.chat?.id,
    messageId: ctx.message?.message_id,
    stageKey: stage,
    agentKey: 'sb-main',
  });
}
