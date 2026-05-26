import type { Context } from 'grammy';
import type { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import { buildChatSystemPrompt } from '../ai/system-prompt.js';
import { runAgent, runMatchAnalysis } from '../ai/deepseek.js';
import { getLatestSystemPrompt } from '../db/agents.js';
import { getMatch, setMatchTargetMessageId, updateMatchStatus } from '../db/matches.js';
import { getChatHistory, logMessage } from '../db/messages.js';
import type { ToolContext } from '../tools/handlers.js';
import { getUser, isUserBlocked, upsertTelegramUser } from '../db/users.js';
import { splitTelegramMessage, normalizeMatchResult, parseMatchStart } from '../utils/text.js';
import type { BotInfo } from '../db/bots.js';

export interface AppContext {
  config: AppConfig;
  botInfo: BotInfo;
}

const BLOCKED_USER_MESSAGE = '不好意思!\n您的活動已被封鎖，請聯絡 @sexycandyhk';

export function registerHandlers(bot: Bot, app: AppContext) {
  const toolContext = (userId?: number): ToolContext => ({
    config: app.config,
    api: bot.api,
    userId,
  });

  bot.command('start', async (ctx) => {
    const text = ctx.message?.text ?? '/start';
    const matchId = parseMatchStart(text);

    if (matchId) {
      await handleMatchStart(ctx, app, matchId);
      return;
    }

    await handleChat(ctx, app, toolContext(ctx.from?.id), '你好，我剛開始使用 SweetBonb。');
  });

  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    await handleChat(ctx, app, toolContext(ctx.from?.id), ctx.message.text);
  });
}

async function syncUser(ctx: Context, config: AppConfig) {
  const from = ctx.from;
  if (!from) return;

  await upsertTelegramUser(config, {
    userId: from.id,
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });
}

async function handleMatchStart(ctx: Context, app: AppContext, matchId: number) {
  await syncUser(ctx, app.config);
  const from = ctx.from;
  if (!from) return;

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
  });
}

async function handleChat(ctx: Context, app: AppContext, toolCtx: ToolContext, userText: string) {
  await syncUser(ctx, app.config);
  const from = ctx.from;
  if (!from) return;

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

  await logMessage(app.config, {
    userId: from.id,
    username: from.username,
    gender: user?.gender ?? null,
    botHandle: app.botInfo.bot_username,
    msgType: 'incoming-msg',
    msgContent: cleanText,
    chatId: ctx.chat?.id,
    messageId: ctx.message?.message_id,
  });

  await ctx.api.sendChatAction(from.id, 'typing');

  const basePrompt = await getLatestSystemPrompt(app.config, agentFunction);
  if (!basePrompt.trim()) {
    await ctx.reply('AI 服務暫時未能載入設定，請稍後再試。');
    return;
  }

  const systemPrompt = buildChatSystemPrompt({
    basePrompt,
    agentFunction,
    user,
  });

  const history = await getChatHistory(
    app.config,
    from.id,
    app.botInfo.bot_username,
    app.config.CHAT_HISTORY_LIMIT,
  );

  let reply: string;
  try {
    reply = await runAgent({
      config: app.config,
      toolContext: { ...toolCtx, userId: from.id },
      systemPrompt,
      userMessage: cleanText,
      history,
      toolsEnabled: agentFunction === 'sb-main',
      maxIterations: app.config.AGENT_MAX_ITERATIONS,
    });
  } catch (error) {
    console.error('AI agent error:', error);
    reply = '抱歉，AI 暫時未能回應，請稍後再試。';
  }

  for (const chunk of splitTelegramMessage(reply)) {
    await ctx.reply(chunk);
  }

  await logMessage(app.config, {
    userId: from.id,
    username: from.username,
    gender: user?.gender ?? null,
    botHandle: app.botInfo.bot_username,
    msgType: 'send-ai-reply',
    msgContent: reply,
    chatId: ctx.chat?.id,
  });
}

async function handleMatchReply(ctx: Context, app: AppContext, action: 'accept' | 'reject') {
  const from = ctx.from;
  if (!from) return;

  const { executeTool } = await import('../tools/handlers.js');
  const toolCtx: ToolContext = { config: app.config, api: ctx.api };
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
  });
}
