import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { query } from './client.js';

export async function getActivePrompt(
  config: AppConfig,
  agentKey: string,
  stageKey?: string | null,
): Promise<string> {
  if (stageKey) {
    const stageRows = await query<RowDataPacket[]>(
      config,
      `SELECT prompt_text FROM tg_ai_prompt
       WHERE agent_key = ? AND stage_key = ? AND is_active = 1
       ORDER BY version DESC, prompt_id DESC LIMIT 1`,
      [agentKey, stageKey],
    );
    if (stageRows[0]?.prompt_text) {
      return stageRows[0].prompt_text as string;
    }
  }

  const baseRows = await query<RowDataPacket[]>(
    config,
    `SELECT prompt_text FROM tg_ai_prompt
     WHERE agent_key = ? AND stage_key IS NULL AND is_active = 1
     ORDER BY version DESC, prompt_id DESC LIMIT 1`,
    [agentKey],
  );
  return (baseRows[0]?.prompt_text as string | undefined) ?? '';
}

export async function buildAgentPrompt(
  config: AppConfig,
  agentKey: string,
  stageKey?: string | null,
): Promise<string> {
  const base = await getActivePrompt(config, agentKey, null);
  const parts: string[] = [];
  if (base.trim()) parts.push(base.trim());
  if (stageKey) {
    const overlay = await getActivePrompt(config, agentKey, stageKey);
    if (overlay.trim()) parts.push(overlay.trim());
  }
  return parts.join('\n\n');
}
