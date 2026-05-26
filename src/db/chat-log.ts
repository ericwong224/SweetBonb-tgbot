import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';
import { savePostDataItem } from './posts.js';

export type ChatRole = 'user' | 'assistant' | 'system';
export type ChatMsgStatus = 'waiting' | 'done' | 'del-whole';

export interface ChatMessageRow extends RowDataPacket {
  id: number;
  user_id: number;
  bot_handle: string;
  role: ChatRole;
  msg_type: string;
  msg_status: ChatMsgStatus;
  content: string;
  stage_key: string | null;
  agent_key: string | null;
  chat_id: number | null;
  message_id: number | null;
  sysmsg: string | null;
  created_at: Date;
}

export function roleToMsgType(role: ChatRole): string {
  if (role === 'user') return 'incoming-msg';
  if (role === 'assistant') return 'send-ai-reply';
  return 'send-sys-msg';
}

export async function appendChatMessage(
  config: AppConfig,
  data: {
    userId: number;
    botHandle: string;
    role: ChatRole;
    content: string;
    stageKey?: string | null;
    agentKey?: string | null;
    chatId?: number;
    messageId?: number;
    msgType?: string;
    msgStatus?: ChatMsgStatus;
  },
): Promise<number> {
  const msgType = data.msgType ?? roleToMsgType(data.role);
  const result = await execute(
    config,
    `INSERT INTO tg_chat_message
     (user_id, bot_handle, role, msg_type, msg_status, content, stage_key, agent_key, chat_id, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.userId,
      data.botHandle,
      data.role,
      msgType,
      data.msgStatus ?? 'done',
      data.content,
      data.stageKey ?? null,
      data.agentKey ?? null,
      data.chatId ?? data.userId,
      data.messageId ?? null,
    ],
  );

  await execute(
    config,
    `INSERT INTO msg_record (user_id, username, gender, bot_handle, msg_type, msg_content, msg_status)
     VALUES (?, NULL, NULL, ?, ?, ?, ?)`,
    [data.userId, data.botHandle, msgType, data.content, data.msgStatus ?? 'done'],
  ).catch(() => undefined);

  return result.insertId;
}

export async function getChatHistory(
  config: AppConfig,
  userId: number,
  botHandle: string,
  limit: number,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await query<ChatMessageRow[]>(
    config,
    `SELECT role, content FROM tg_chat_message
     WHERE user_id = ? AND bot_handle = ? AND msg_status = 'done'
       AND msg_type IN ('incoming-msg', 'send-ai-reply')
     ORDER BY created_at DESC LIMIT ?`,
    [userId, botHandle, limit],
  );

  return rows
    .reverse()
    .map((row) => ({
      role: row.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: row.content,
    }))
    .filter((m) => m.content?.trim());
}

export async function pickNextDeletableMessage(
  config: AppConfig,
  botHandle: string,
  inactiveHours: number,
  maxAgeHours: number,
): Promise<ChatMessageRow | null> {
  const rows = await query<ChatMessageRow[]>(
    config,
    `SELECT m.*
     FROM tg_chat_message m
     INNER JOIN tg_user_profile p ON m.chat_id = p.user_id
     WHERE m.bot_handle = ?
       AND m.msg_status = 'done'
       AND m.message_id IS NOT NULL
       AND (
         (m.msg_type IN ('send-ai-reply', 'incoming-msg')
          AND p.last_online <= DATE_SUB(NOW(), INTERVAL ? HOUR))
         OR m.created_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
       )
     ORDER BY m.created_at ASC
     LIMIT 1`,
    [botHandle, inactiveHours, maxAgeHours],
  );
  return rows[0] ?? null;
}

export async function markMessageDelWhole(
  config: AppConfig,
  id: number,
  sysmsg?: string,
): Promise<void> {
  await execute(config, `UPDATE tg_chat_message SET msg_status = 'del-whole', sysmsg = ? WHERE id = ?`, [
    sysmsg ?? null,
    id,
  ]);
}

export async function savePostResponseWithLegacy(
  config: AppConfig,
  userId: number,
  fieldKey: string,
  content: string,
): Promise<void> {
  await execute(
    config,
    `INSERT INTO tg_post_response (user_id, field_key, content) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = NOW()`,
    [userId, fieldKey, content],
  );
  await savePostDataItem(config, userId, fieldKey, content);
}
