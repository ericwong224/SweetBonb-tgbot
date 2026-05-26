import type { Context } from 'grammy';
import type { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import { buildChatSystemPrompt } from '../ai/system-prompt.js';
import { runAgent, runMatchAnalysis } from '../ai/deepseek.js';
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
} from '../utils/text.js';
import type { BotInfo } from '../db/bots.js';
import {
  applyLanguageChoice,
  handleHelpCommand,
  handleStatusCommand,
  sendLanguagePicker,
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

      if (!(await ensureLanguageOrPrompt(ctx, app.config, '', app.botInfo))) {
        return;
      }

      await handleChat(ctx, app, toolContext(ctx.from?.id), '你好，我剛開始使用 SweetBonb。');
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
    if (!data.startsWith('lang:')) return;

    const lang = data.slice(5) as UserLanguage;
    if (!['zh-spoken', 'zh-written', 'en'].includes(lang)) {
      await ctx.answerCallbackQuery({ text: 'Invalid language' });
      return;
    }

    await ctx.answerCallbackQuery();
    await applyLanguageChoice(ctx, app.config, lang, app.botInfo);
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
        const reply = `你收到一個配對請求：\n\n${tgMatch.initiator_snapshot ?? ''}\n\n是否接受這個配對？回覆「接受」或「拒絕」。`;
        const sent = await ctx.reply(reply);
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
      const reply = `你收到一個配對請求：\n\n${match.initiator_data ?? ''}\n\n是否接受這個配對？回覆「接受」或「拒絕」。`;
      const sent = await ctx.reply(reply);
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
): Promise<boolean> {
  const from = ctx.from;
  if (!from) return false;

  const profile = await getProfile(config, from.id);
  if (!needsLanguageSelection(profile)) return true;

  const parsed = parseLanguageInput(userText);
  if (parsed) {
    await applyLanguageChoice(ctx, config, parsed, botInfo);
    return false;
  }

  await sendLanguagePicker(ctx);
  return false;
}

async function handleChat(ctx: Context, app: AppContext, toolCtx: ToolContext, userText: string) {
  await syncUser(ctx, app.config);
  const from = ctx.from;
  if (!from) return;

  if (!(await ensureLanguageOrPrompt(ctx, app.config, userText, app.botInfo))) {
    return;
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
    await ctx.reply('AI 服務暫時未能載入設定，請稍後再試。');
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
    logError('ai', 'Agent failed', {
      userId: from.id,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('AI agent error:', error);
    reply = '抱歉，AI 暫時未能回應，請稍後再試。';
  }

  logInfo('message', 'AI reply sent', {
    userId: from.id,
    stage,
    preview: reply.slice(0, 120),
  });

  let lastMessageId: number | undefined;
  for (const chunk of splitTelegramMessage(reply)) {
    const sent = await ctx.reply(chunk);
    lastMessageId = sent.message_id;
  }

  await logMessage(app.config, {
    userId: from.id,
    username: from.username,
    gender: user?.gender ?? null,
    botHandle: app.botInfo.bot_username,
    msgType: 'send-ai-reply',
    msgContent: reply,
    chatId: ctx.chat?.id,
    messageId: lastMessageId,
    stageKey: stage,
    agentKey: agentFunction,
  });
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
