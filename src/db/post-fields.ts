import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';

export interface PostFieldDef extends RowDataPacket {
  field_key: string;
  label_zh: string;
  sort_order: number;
  required: number;
  hint: string | null;
  active: number;
}

export async function getPostFieldDefs(config: AppConfig): Promise<PostFieldDef[]> {
  return query<PostFieldDef[]>(
    config,
    'SELECT * FROM tg_post_field_def WHERE active = 1 ORDER BY sort_order, field_key',
  );
}

export async function getPostResponseMap(
  config: AppConfig,
  userId: number,
): Promise<Record<string, string>> {
  const rows = await query<RowDataPacket[]>(
    config,
    'SELECT field_key, content FROM tg_post_response WHERE user_id = ?',
    [userId],
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.field_key as string] = row.content as string;
  }
  return map;
}

export async function savePostResponse(
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

  const { savePostDataItem } = await import('./posts.js');
  await savePostDataItem(config, userId, fieldKey, content);
}

export async function checkPostResponsesComplete(
  config: AppConfig,
  userId: number,
): Promise<{ complete: boolean; missing: string[]; data: Record<string, string> }> {
  const defs = await getPostFieldDefs(config);
  const data = await getPostResponseMap(config, userId);
  const required = defs.filter((d) => d.required === 1);
  const missing = required.filter((d) => !data[d.field_key]?.trim()).map((d) => d.field_key);
  return { complete: missing.length === 0, missing, data };
}
