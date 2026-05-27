import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';

export async function getPostDataMap(
  config: AppConfig,
  userId: number,
): Promise<Record<string, string>> {
  const rows = await query<RowDataPacket[]>(
    config,
    'SELECT item, content FROM n8n_post_data WHERE user_id = ? ORDER BY update_datetime DESC, post_data_id DESC',
    [userId],
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!map[row.item as string]) {
      map[row.item as string] = row.content as string;
    }
  }
  return map;
}

export async function getRequiredPostItems(config: AppConfig): Promise<string[]> {
  const rows = await query<RowDataPacket[]>(
    config,
    'SELECT item_name FROM n8n_post_data_item ORDER BY item_name',
  );
  return rows.map((r) => r.item_name as string);
}

export async function checkPostData(
  config: AppConfig,
  userId: number,
): Promise<{ complete: boolean; missing: string[]; data: Record<string, string> }> {
  const required = await getRequiredPostItems(config);
  const data = await getPostDataMap(config, userId);
  const missing = required.filter((item) => !data[item]?.trim());
  return { complete: missing.length === 0, missing, data };
}

export async function savePostDataItem(
  config: AppConfig,
  userId: number,
  item: string,
  content: string,
): Promise<void> {
  const existing = await query<RowDataPacket[]>(
    config,
    'SELECT post_data_id FROM n8n_post_data WHERE user_id = ? AND item = ? ORDER BY post_data_id DESC LIMIT 1',
    [userId, item],
  );

  if (existing[0]) {
    await execute(
      config,
      'UPDATE n8n_post_data SET content = ?, update_datetime = NOW() WHERE post_data_id = ?',
      [content, existing[0].post_data_id],
    );
    return;
  }

  await execute(
    config,
    'INSERT INTO n8n_post_data (user_id, item, content, update_datetime) VALUES (?, ?, ?, NOW())',
    [userId, item, content],
  );
}

export async function getChannelInfo(config: AppConfig) {
  const rows = await query<RowDataPacket[]>(
    config,
    'SELECT channel_id, channel_name, channel_username, channel_mode, for_post, area FROM n8n_channel_info ORDER BY channel_id',
  );
  return rows;
}

import { getRegionalChannel } from './channels.js';

export async function getChannelByArea(config: AppConfig, area: string) {
  return getRegionalChannel(config, area);
}

export function buildPostFormat1(
  location: string,
  gender: string,
  age: number,
  relationshipStatus: string,
  postData: Record<string, string>,
): string {
  const genderLabel = gender === 'M' ? '男' : '女';
  const targetGender = postData.target_gender ?? '';
  const targetRel = postData.target_relationship ?? '';
  const targetAge = postData.target_age ?? '';

  return [
    `【${location}】🌟 ${genderLabel} ${age}歲 ${relationshipStatus}`,
    `💕 尋找 ${targetGender}${targetRel ? ` · ${targetRel}` : ''}`,
    targetAge ? `年齡 ${targetAge}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildPostFormatsFromProfile(
  location: string,
  gender: string,
  dob: Date,
  postData: Record<string, string>,
): { short: string; detailed: string } {
  const age = calcAge(dob);
  const relationshipStatus = postData.member_relationship_status ?? '單身';
  const height = postData.member_height ?? '';
  const weight = postData.member_weight ?? '';
  const securePairing = postData.secure_pairing_options ?? '';

  return {
    short: buildPostFormat1(location, gender, age, relationshipStatus, postData),
    detailed: buildPostFormat2(
      location,
      gender,
      age,
      relationshipStatus,
      height,
      weight,
      postData,
      securePairing,
    ),
  };
}

export function buildPostFormat2(
  location: string,
  gender: string,
  age: number,
  relationshipStatus: string,
  height: string,
  weight: string,
  postData: Record<string, string>,
  securePairing: string,
): string {
  const genderLabel = gender === 'M' ? '男' : '女';
  const targetGender = postData.target_gender === '男' ? '男' : postData.target_gender === '女' ? '女' : postData.target_gender ?? '';
  const secure = securePairing.includes('不顯示') ? '只接受安全配對' : '';

  return [
    `【${location}】`,
    `🌟 招募者資料`,
    `${genderLabel} ${age}歲 ${relationshipStatus}`,
    `高 ${height}  重 ${weight}`,
    '',
    `[簡介] 👓`,
    postData.member_profile ?? '',
    '',
    `[經驗] 💼`,
    postData.member_sexual_experience ?? '',
    '',
    `[性趣] 🔥`,
    postData.other_sexual_interests ?? postData.acceptance_questionnaire ?? '',
    '',
    `💕 尋找對象`,
    `${targetGender} ${postData.target_relationship ?? ''}`,
    `年齡 ${postData.target_age ?? ''}  高 ${postData.target_height ?? ''}`,
    `期望感情狀況 ${postData.target_relationship_status ?? ''}`,
    '',
    `[外表要求] 💃`,
    postData.target_bodyshape ?? '',
    '',
    secure,
  ]
    .filter(Boolean)
    .join('\n');
}

export function calcAge(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}
