import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { query } from './client.js';

export interface BotInfo extends RowDataPacket {
  bot_id: number;
  bot_mode: 'live' | 'test' | 'demo' | 'admin';
  bot_username: string;
  bot_token: string;
  bot_admin_id: number;
}

export async function getBotInfo(config: AppConfig, mode: string): Promise<BotInfo | null> {
  const rows = await query<BotInfo[]>(
    config,
    'SELECT * FROM n8n_bot_info WHERE bot_mode = ? LIMIT 1',
    [mode],
  );
  return rows[0] ?? null;
}
