import type { UserProfileRow } from '../db/profile.js';
import { getMissingBasicFields } from '../db/profile.js';
import type { UserStage } from '../flow/stages.js';

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function buildUserContextBlock(options: {
  profile: UserProfileRow | null;
  stage: UserStage;
  postStatus?: string;
  missingPostFields?: string[];
}): string {
  const { profile, stage, postStatus, missingPostFields = [] } = options;

  if (!profile) {
    return `##用戶資料\n（新用戶，資料尚未完整）\n##當前流程階段\n${stage}`;
  }

  const missingBasic = getMissingBasicFields(profile);
  const lines = [
    '##用戶資料',
    `user_id=>${profile.user_id}`,
    `tg username:${profile.telegram_username ?? ''}`,
    `性別:${profile.gender ?? ''}`,
    `出生日期:${formatDate(profile.dob)}`,
    `居住地:${profile.location ?? ''}`,
    `最後活動時間:${profile.last_online ? formatDateTime(new Date(profile.last_online)) : ''}`,
    `啟示狀況:${postStatus ?? 'draft'}`,
    `##當前流程階段\n${stage}`,
  ];

  if (missingBasic.length) {
    lines.push(`##尚未完成的基本資料\n${missingBasic.join(', ')}`);
  }
  if (missingPostFields.length) {
    lines.push(`##尚未完成的啟示問卷\n${missingPostFields.join(', ')}`);
  }

  return lines.join('\n');
}

export function buildChatSystemPrompt(options: {
  basePrompt: string;
  agentFunction: 'sb-main' | 'sb-admin' | 'sb-match';
  profile: UserProfileRow | null;
  stage?: UserStage;
  postStatus?: string;
  missingPostFields?: string[];
  now?: Date;
}): string {
  const {
    basePrompt,
    agentFunction,
    profile,
    stage = 'profile_incomplete',
    postStatus,
    missingPostFields,
    now = new Date(),
  } = options;

  const parts = [`現在時間(24小時制)=>${formatDateTime(now)}`];

  if (basePrompt.trim()) {
    parts.push(basePrompt.trim());
  }

  if (agentFunction === 'sb-main') {
    parts.push(
      buildUserContextBlock({ profile, stage, postStatus, missingPostFields }),
    );
  }

  return parts.join('\n\n');
}
