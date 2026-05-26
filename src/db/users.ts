import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';

export interface UserRow extends RowDataPacket {
  user_id: number;
  username: string | null;
  last_name: string | null;
  first_name: string | null;
  dob: Date | null;
  gender: 'M' | 'F' | null;
  joined: Date;
  last_online: Date | null;
  acc_active: number;
  acc_block: number;
  location: string | null;
  post_on: 'draft' | 'on-hold' | 'publish' | null;
  post_format_2: string | null;
  post_channel_id: number | null;
}

export async function getUser(config: AppConfig, userId: number): Promise<UserRow | null> {
  const rows = await query<UserRow[]>(
    config,
    'SELECT * FROM users WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function upsertTelegramUser(
  config: AppConfig,
  data: {
    userId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
  },
): Promise<void> {
  await execute(
    config,
    `INSERT INTO users (user_id, username, first_name, last_name, last_online, joined, acc_active)
     VALUES (?, ?, ?, ?, NOW(), NOW(), 1)
     ON DUPLICATE KEY UPDATE
       username = COALESCE(VALUES(username), username),
       first_name = COALESCE(VALUES(first_name), first_name),
       last_name = COALESCE(VALUES(last_name), last_name),
       last_online = NOW(),
       acc_active = 1`,
    [data.userId, data.username ?? null, data.firstName ?? null, data.lastName ?? null],
  );
}

export function isUserBlocked(user: UserRow | null): boolean {
  return user?.acc_block === 1;
}

export async function updateUserField(
  config: AppConfig,
  userId: number,
  field: 'gender' | 'dob' | 'location' | 'username',
  value: string,
): Promise<void> {
  const allowed = ['gender', 'dob', 'location', 'username'] as const;
  if (!allowed.includes(field)) {
    throw new Error(`Unsupported field: ${field}`);
  }
  await execute(config, `UPDATE users SET ${field} = ? WHERE user_id = ?`, [value, userId]);
}

export async function updatePostStatus(
  config: AppConfig,
  userId: number,
  status: 'draft' | 'on-hold' | 'publish',
): Promise<void> {
  await execute(config, 'UPDATE users SET post_on = ? WHERE user_id = ?', [status, userId]);
}

export async function updatePostFormat(
  config: AppConfig,
  userId: number,
  postFormat2: string,
): Promise<void> {
  await execute(config, 'UPDATE users SET post_format_2 = ? WHERE user_id = ?', [
    postFormat2,
    userId,
  ]);
}

export function buildMemberInfo(user: UserRow | null, postData: Record<string, string>) {
  const missing: string[] = [];
  if (!user?.username) missing.push('telegram username');
  if (!user?.gender) missing.push('gender');
  if (!user?.dob) missing.push('dob');
  if (!user?.location) missing.push('location');

  return {
    user_id: user?.user_id ?? null,
    username: user?.username ?? null,
    first_name: user?.first_name ?? null,
    gender: user?.gender ?? null,
    dob: user?.dob ? user.dob.toISOString().slice(0, 10) : null,
    location: user?.location ?? null,
    post_on: user?.post_on ?? 'draft',
    post_format_2: user?.post_format_2 ?? null,
    missing_basic_fields: missing,
    post_data: postData,
  };
}
