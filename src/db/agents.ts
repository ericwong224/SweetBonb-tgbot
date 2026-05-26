import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { query } from './client.js';

export async function getLatestSystemPrompt(
  config: AppConfig,
  agentFunction: string,
): Promise<string> {
  const rows = await query<RowDataPacket[]>(
    config,
    `SELECT s.sysmsg
     FROM n8n_ai_agent_sysmsg s
     JOIN n8n_ai_agent a ON a.ai_agent_id = s.ai_agent_id
     WHERE a.ai_agent_function = ?
     ORDER BY s.ver DESC, s.sysmsg_id DESC
     LIMIT 1`,
    [agentFunction],
  );
  return (rows[0]?.sysmsg as string | undefined) ?? '';
}
