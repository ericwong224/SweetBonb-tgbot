import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';

export interface MatchRow extends RowDataPacket {
  match_id: number;
  initiator_id: number;
  target_id: number;
  match_date: Date | null;
  target_msg_id: number | null;
  match_status: string;
  match_rate: number | null;
  target_data: string | null;
  initiator_data: string | null;
  analyze_data: string | null;
}

export async function getMatch(config: AppConfig, matchId: number): Promise<MatchRow | null> {
  const rows = await query<MatchRow[]>(
    config,
    'SELECT * FROM n8n_match_data WHERE match_id = ? LIMIT 1',
    [matchId],
  );
  return rows[0] ?? null;
}

export async function getPendingMatchRequests(
  config: AppConfig,
  targetUserId: number,
): Promise<MatchRow[]> {
  return query<MatchRow[]>(
    config,
    `SELECT * FROM n8n_match_data
     WHERE target_id = ? AND match_status IN ('request', 'Waiting-for-reply')
     ORDER BY match_date DESC`,
    [targetUserId],
  );
}

export async function updateMatchStatus(
  config: AppConfig,
  matchId: number,
  status: string,
  analyzeData?: string,
  matchRate?: number,
): Promise<void> {
  if (analyzeData !== undefined && matchRate !== undefined) {
    await execute(
      config,
      'UPDATE n8n_match_data SET match_status = ?, analyze_data = ?, match_rate = ? WHERE match_id = ?',
      [status, analyzeData, matchRate, matchId],
    );
    return;
  }
  await execute(config, 'UPDATE n8n_match_data SET match_status = ? WHERE match_id = ?', [
    status,
    matchId,
  ]);
}

export async function setMatchTargetMessageId(
  config: AppConfig,
  matchId: number,
  messageId: number,
): Promise<void> {
  await execute(config, 'UPDATE n8n_match_data SET target_msg_id = ? WHERE match_id = ?', [
    messageId,
    matchId,
  ]);
}
