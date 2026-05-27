import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';

export type PostStatus = 'draft' | 'on-hold' | 'publish';

export interface UserPostRow extends RowDataPacket {
  user_id: number;
  status: PostStatus;
  body_format: string | null;
  body_short: string | null;
  channel_id: number | null;
  channel_message_id: number | null;
  main_channel_id: number | null;
  main_channel_message_id: number | null;
  published_at: Date | null;
}

export async function getUserPost(
  config: AppConfig,
  userId: number,
): Promise<UserPostRow | null> {
  const rows = await query<UserPostRow[]>(
    config,
    'SELECT * FROM tg_user_post WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function ensureUserPost(config: AppConfig, userId: number): Promise<void> {
  await execute(
    config,
    `INSERT IGNORE INTO tg_user_post (user_id, status) VALUES (?, 'draft')`,
    [userId],
  );
}

export async function setUserPostStatus(
  config: AppConfig,
  userId: number,
  status: PostStatus,
): Promise<void> {
  await ensureUserPost(config, userId);
  await execute(config, 'UPDATE tg_user_post SET status = ? WHERE user_id = ?', [status, userId]);
  await execute(config, 'UPDATE users SET post_on = ? WHERE user_id = ?', [status, userId]);
}

export async function updateUserPostBody(
  config: AppConfig,
  userId: number,
  bodyFormat: string,
  bodyShort?: string,
): Promise<void> {
  await ensureUserPost(config, userId);
  if (bodyShort != null) {
    await execute(
      config,
      'UPDATE tg_user_post SET body_format = ?, body_short = ? WHERE user_id = ?',
      [bodyFormat, bodyShort, userId],
    );
    await execute(config, 'UPDATE users SET post_format_2 = ?, post_format_1 = ? WHERE user_id = ?', [
      bodyFormat,
      bodyShort,
      userId,
    ]);
    return;
  }

  await execute(config, 'UPDATE tg_user_post SET body_format = ? WHERE user_id = ?', [
    bodyFormat,
    userId,
  ]);
  await execute(config, 'UPDATE users SET post_format_2 = ? WHERE user_id = ?', [
    bodyFormat,
    userId,
  ]);
}

export async function markUserPostPublished(
  config: AppConfig,
  userId: number,
  regionalChannelId: number,
  regionalMessageId: number,
  mainChannelId: number,
  mainMessageId: number,
): Promise<void> {
  await ensureUserPost(config, userId);
  await execute(
    config,
    `UPDATE tg_user_post SET status = 'publish', channel_id = ?, channel_message_id = ?,
     main_channel_id = ?, main_channel_message_id = ?, published_at = NOW() WHERE user_id = ?`,
    [regionalChannelId, regionalMessageId, mainChannelId, mainMessageId, userId],
  );
  await execute(
    config,
    `UPDATE users SET post_on = 'publish', post_channel_id = ? WHERE user_id = ?`,
    [regionalChannelId, userId],
  );
}

export async function resetUserPostDraft(config: AppConfig, userId: number): Promise<void> {
  await ensureUserPost(config, userId);
  await execute(
    config,
    `UPDATE tg_user_post SET status = 'draft', body_format = NULL, body_short = NULL,
     channel_id = NULL, channel_message_id = NULL, main_channel_id = NULL,
     main_channel_message_id = NULL, published_at = NULL WHERE user_id = ?`,
    [userId],
  );
  await execute(
    config,
    `UPDATE users SET post_on = 'draft', post_format_1 = NULL, post_format_2 = NULL,
     post_format_footer = NULL, post_channel_id = NULL WHERE user_id = ?`,
    [userId],
  );
}

export function isPostPublished(post: UserPostRow | null): boolean {
  return post?.status === 'publish';
}
