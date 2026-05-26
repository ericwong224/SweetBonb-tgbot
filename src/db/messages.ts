import type { AppConfig } from '../config.js';
import {
  appendChatMessage,
  getChatHistory as getChatHistoryFromTg,
  type ChatMsgStatus,
} from './chat-log.js';

export type MsgType =
  | 'send-sys-msg'
  | 'send-ai-reply'
  | 'incoming-msg'
  | 'match-request'
  | 'match-msg'
  | 'send-ai-remind'
  | 'send-ig-post';

export async function logMessage(
  config: AppConfig,
  data: {
    userId: number;
    username?: string | null;
    gender?: 'M' | 'F' | null;
    botHandle: string;
    msgType: MsgType;
    msgContent: string;
    msgStatus?: ChatMsgStatus;
    chatId?: number;
    messageId?: number;
    stageKey?: string | null;
    agentKey?: string | null;
    sysmsg?: string;
  },
): Promise<void> {
  const role =
    data.msgType === 'incoming-msg'
      ? ('user' as const)
      : data.msgType === 'send-ai-reply'
        ? ('assistant' as const)
        : ('system' as const);

  await appendChatMessage(config, {
    userId: data.userId,
    botHandle: data.botHandle,
    role,
    content: data.msgContent,
    msgType: data.msgType,
    msgStatus: data.msgStatus ?? 'done',
    chatId: data.chatId,
    messageId: data.messageId,
    stageKey: data.stageKey,
    agentKey: data.agentKey,
  });
}

export async function getChatHistory(
  config: AppConfig,
  userId: number,
  botHandle: string,
  limit: number,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  return getChatHistoryFromTg(config, userId, botHandle, limit);
}
