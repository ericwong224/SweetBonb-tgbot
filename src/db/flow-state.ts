import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';

export type UserStage =
  | 'profile_incomplete'
  | 'profile_complete'
  | 'post_ready'
  | 'post_published';

export interface UserFlowRow extends RowDataPacket {
  user_id: number;
  stage: UserStage;
  updated_at: Date;
}

export async function getUserFlow(
  config: AppConfig,
  userId: number,
): Promise<UserFlowRow | null> {
  const rows = await query<UserFlowRow[]>(
    config,
    'SELECT * FROM tg_user_flow WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function upsertUserFlow(
  config: AppConfig,
  userId: number,
  stage: UserStage,
): Promise<void> {
  await execute(
    config,
    `INSERT INTO tg_user_flow (user_id, stage) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE stage = VALUES(stage), updated_at = NOW()`,
    [userId, stage],
  );
}
