import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';
import type { RowDataPacket } from 'mysql2/promise';

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
    msgStatus?: 'done' | 'waiting';
    chatId?: number;
    messageId?: number;
    sysmsg?: string;
  },
): Promise<void> {
  await execute(
    config,
    `INSERT INTO msg_record (user_id, username, gender, bot_handle, msg_type, msg_content, msg_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.userId,
      data.username ?? null,
      data.gender ?? null,
      data.botHandle,
      data.msgType,
      data.msgContent,
      data.msgStatus ?? 'done',
    ],
  );

  await execute(
    config,
    `INSERT INTO n8n_msg_record (msg_type, bot_handle, chat_id, message_id, msg_content, msg_status, sysmsg)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.msgType,
      data.botHandle,
      data.chatId ?? data.userId,
      data.messageId ?? null,
      data.msgContent,
      data.msgStatus ?? 'done',
      data.sysmsg ?? null,
    ],
  );
}

export async function getChatHistory(
  config: AppConfig,
  userId: number,
  botHandle: string,
  limit: number,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await query<RowDataPacket[]>(
    config,
    `SELECT msg_type, msg_content
     FROM msg_record
     WHERE user_id = ? AND bot_handle = ? AND msg_type IN ('incoming-msg', 'send-ai-reply')
     ORDER BY msg_date DESC
     LIMIT ?`,
    [userId, botHandle, limit],
  );

  return rows
    .reverse()
    .map((row) => ({
      role: row.msg_type === 'incoming-msg' ? ('user' as const) : ('assistant' as const),
      content: row.msg_content as string,
    }))
    .filter((m) => m.content?.trim());
}
