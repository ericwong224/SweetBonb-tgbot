import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';

export interface TgMatchRow extends RowDataPacket {
  match_id: number;
  initiator_id: number;
  target_id: number;
  status: string;
  initiator_snapshot: string | null;
  target_snapshot: string | null;
  analyze_data: string | null;
  match_rate: number | null;
  target_msg_id: number | null;
  created_at: Date;
}

export async function createTgMatch(
  config: AppConfig,
  initiatorId: number,
  targetId: number,
  initiatorSnapshot: string,
  targetSnapshot: string,
): Promise<number> {
  const result = await execute(
    config,
    `INSERT INTO tg_match (initiator_id, target_id, status, initiator_snapshot, target_snapshot)
     VALUES (?, ?, 'request', ?, ?)`,
    [initiatorId, targetId, initiatorSnapshot, targetSnapshot],
  );
  return result.insertId;
}

export async function getTgMatch(
  config: AppConfig,
  matchId: number,
): Promise<TgMatchRow | null> {
  const rows = await query<TgMatchRow[]>(
    config,
    'SELECT * FROM tg_match WHERE match_id = ? LIMIT 1',
    [matchId],
  );
  return rows[0] ?? null;
}

export async function getPendingTgMatchRequests(
  config: AppConfig,
  targetUserId: number,
): Promise<TgMatchRow[]> {
  return query<TgMatchRow[]>(
    config,
    `SELECT * FROM tg_match
     WHERE target_id = ? AND status IN ('request', 'Waiting-for-reply')
     ORDER BY created_at DESC`,
    [targetUserId],
  );
}

export async function updateTgMatchStatus(
  config: AppConfig,
  matchId: number,
  status: string,
  analyzeData?: string,
  matchRate?: number,
): Promise<void> {
  if (analyzeData !== undefined && matchRate !== undefined) {
    await execute(
      config,
      'UPDATE tg_match SET status = ?, analyze_data = ?, match_rate = ? WHERE match_id = ?',
      [status, analyzeData, matchRate, matchId],
    );
    return;
  }
  await execute(config, 'UPDATE tg_match SET status = ? WHERE match_id = ?', [status, matchId]);
}

export async function setTgMatchTargetMessageId(
  config: AppConfig,
  matchId: number,
  messageId: number,
): Promise<void> {
  await execute(config, 'UPDATE tg_match SET target_msg_id = ? WHERE match_id = ?', [
    messageId,
    matchId,
  ]);
}

export async function findExistingTgMatch(
  config: AppConfig,
  initiatorId: number,
  targetId: number,
): Promise<TgMatchRow | null> {
  const rows = await query<TgMatchRow[]>(
    config,
    `SELECT * FROM tg_match
     WHERE initiator_id = ? AND target_id = ?
       AND status IN ('request', 'Waiting-for-reply')
     ORDER BY created_at DESC LIMIT 1`,
    [initiatorId, targetId],
  );
  return rows[0] ?? null;
}
