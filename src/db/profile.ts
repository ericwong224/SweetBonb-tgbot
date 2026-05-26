import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { execute, query } from './client.js';

export interface UserProfileRow extends RowDataPacket {
  user_id: number;
  telegram_username: string | null;
  gender: 'M' | 'F' | null;
  dob: Date | null;
  location: string | null;
  preferred_language: 'zh-spoken' | 'zh-written' | 'en' | null;
  last_online: Date | null;
  acc_active: number;
  completed_at: Date | null;
}

export function getMissingBasicFields(profile: UserProfileRow | null): string[] {
  const missing: string[] = [];
  if (!profile?.telegram_username?.trim()) missing.push('telegram username');
  if (!profile?.gender) missing.push('gender');
  if (!profile?.dob) missing.push('dob');
  if (!profile?.location?.trim()) missing.push('location');
  return missing;
}

export function isProfileComplete(profile: UserProfileRow | null): boolean {
  return getMissingBasicFields(profile).length === 0;
}

export async function getProfile(
  config: AppConfig,
  userId: number,
): Promise<UserProfileRow | null> {
  const rows = await query<UserProfileRow[]>(
    config,
    'SELECT * FROM tg_user_profile WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function upsertProfileFromTelegram(
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
    `INSERT INTO tg_user_profile (user_id, telegram_username, last_online)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       telegram_username = COALESCE(VALUES(telegram_username), telegram_username),
       last_online = NOW()`,
    [data.userId, data.username ?? null],
  );

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

export async function setPreferredLanguage(
  config: AppConfig,
  userId: number,
  language: 'zh-spoken' | 'zh-written' | 'en',
): Promise<void> {
  await execute(
    config,
    `INSERT INTO tg_user_profile (user_id, preferred_language, last_online)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE preferred_language = VALUES(preferred_language), last_online = NOW()`,
    [userId, language],
  );
}

export async function updateProfileField(
  config: AppConfig,
  userId: number,
  field: 'gender' | 'dob' | 'location' | 'username',
  value: string,
): Promise<void> {
  const col =
    field === 'username'
      ? 'telegram_username'
      : field === 'dob'
        ? 'dob'
        : field === 'gender'
          ? 'gender'
          : 'location';

  await execute(config, `UPDATE tg_user_profile SET ${col} = ? WHERE user_id = ?`, [
    value,
    userId,
  ]);

  const legacyField = field === 'username' ? 'username' : field;
  await execute(config, `UPDATE users SET ${legacyField} = ? WHERE user_id = ?`, [value, userId]);

  const profile = await getProfile(config, userId);
  if (isProfileComplete(profile)) {
    await execute(config, 'UPDATE tg_user_profile SET completed_at = NOW() WHERE user_id = ?', [
      userId,
    ]);
  }
}

export async function deactivateProfile(config: AppConfig, userId: number): Promise<void> {
  await execute(config, 'UPDATE tg_user_profile SET acc_active = 0 WHERE user_id = ?', [userId]);
  await execute(config, 'UPDATE users SET acc_active = 0, post_on = ? WHERE user_id = ?', [
    'draft',
    userId,
  ]);
}

export function profileToMemberInfo(
  profile: UserProfileRow | null,
  postData: Record<string, string>,
  postStatus: string,
  bodyFormat: string | null,
) {
  return {
    user_id: profile?.user_id ?? null,
    username: profile?.telegram_username ?? null,
    gender: profile?.gender ?? null,
    dob: profile?.dob ? profile.dob.toISOString().slice(0, 10) : null,
    location: profile?.location ?? null,
    preferred_language: profile?.preferred_language ?? null,
    post_on: postStatus,
    post_format_2: bodyFormat,
    missing_basic_fields: getMissingBasicFields(profile),
    post_data: postData,
  };
}
