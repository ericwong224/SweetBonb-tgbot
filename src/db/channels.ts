import type { Api } from 'grammy';
import type { RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from '../config.js';
import { query } from './client.js';

export interface ChannelRow extends RowDataPacket {
  channel_id: number | bigint;
  channel_name: string | null;
  channel_username: string | null;
  channel_mode: string | null;
  for_post: number;
  area: string | null;
}

type ChatMemberLike = {
  status: string;
  is_member?: boolean;
};

/** Only creator / administrator / member count as channel members. */
export function isTelegramChatMember(member: ChatMemberLike): boolean {
  switch (member.status) {
    case 'creator':
    case 'administrator':
    case 'member':
      return true;
    default:
      return false;
  }
}

export function channelDisplayName(channel: ChannelRow): string {
  if (channel.channel_username?.trim()) {
    return `@${channel.channel_username.replace(/^@/, '')}`;
  }
  return channel.channel_name?.trim() || String(channel.channel_id);
}

/** Telegram API chat_id: accept @username, -100… supergroups, or legacy bare ids in DB. */
export function normalizeTelegramChatId(channelId: number | bigint | string): number | string {
  if (typeof channelId === 'string' && channelId.startsWith('@')) {
    return channelId;
  }

  const raw = String(channelId).trim();
  if (raw.startsWith('-')) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : raw;
  }

  if (/^\d+$/.test(raw)) {
    if (raw.length >= 9 && raw.length <= 12 && !raw.startsWith('100')) {
      return `-100${raw}`;
    }
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : raw;
  }

  return channelId as number;
}

export function buildChannelMessageLink(
  channelId: number | bigint,
  messageId: number,
  channelUsername?: string | null,
): string {
  if (channelUsername?.trim()) {
    const handle = channelUsername.replace(/^@/, '');
    return `https://t.me/${handle}/${messageId}`;
  }
  const raw = String(Math.abs(Number(channelId)));
  const internal = raw.startsWith('100') ? raw.slice(3) : raw;
  return `https://t.me/c/${internal}/${messageId}`;
}

export async function getChannelById(
  config: AppConfig,
  channelId: number,
): Promise<ChannelRow | null> {
  const rows = await query<ChannelRow[]>(
    config,
    'SELECT * FROM n8n_channel_info WHERE channel_id = ? LIMIT 1',
    [channelId],
  );
  return rows[0] ?? null;
}

export async function listRegionalPostChannels(config: AppConfig): Promise<ChannelRow[]> {
  return query<ChannelRow[]>(
    config,
    'SELECT * FROM n8n_channel_info WHERE for_post = 1 ORDER BY area, channel_id',
  );
}

export async function getMainChannel(config: AppConfig): Promise<ChannelRow | null> {
  const rows = await query<ChannelRow[]>(
    config,
    `SELECT * FROM n8n_channel_info
     WHERE channel_mode IN ('main', 'master', '總頻')
        OR for_post = 0
        OR area IN ('總頻', '總', 'Main', 'ALL')
     ORDER BY
       CASE
         WHEN channel_mode IN ('main', 'master') THEN 0
         WHEN for_post = 0 THEN 1
         WHEN area IN ('總頻', '總') THEN 2
         ELSE 3
       END,
       channel_id
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

/** @deprecated Prefer AI + regional_channel_id; kept for probes/fallback. */
export async function getRegionalChannel(
  config: AppConfig,
  location: string,
): Promise<ChannelRow | null> {
  const trimmed = location.trim();
  if (!trimmed) return null;

  const rows = await query<ChannelRow[]>(
    config,
    `SELECT * FROM n8n_channel_info
     WHERE for_post = 1
       AND (area LIKE ? OR ? LIKE CONCAT('%', area, '%'))
     ORDER BY LENGTH(area) DESC, channel_id
     LIMIT 1`,
    [`%${trimmed}%`, trimmed],
  );
  return rows[0] ?? null;
}

export interface ChannelMemberCheck {
  joined: boolean;
  status?: string;
  is_member?: boolean;
  error?: string;
}

export async function isUserChannelMember(
  api: Api,
  userId: number,
  channelId: number | bigint | string,
): Promise<ChannelMemberCheck> {
  try {
    const chatId = normalizeTelegramChatId(channelId);
    const member = await api.getChatMember(chatId, userId);
    const joined = isTelegramChatMember(member);
    const isMemberFlag =
      'is_member' in member && typeof member.is_member === 'boolean'
        ? member.is_member
        : undefined;
    return { joined, status: member.status, is_member: isMemberFlag };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'check failed';
    return { joined: false, error: message };
  }
}

export interface PublishChannelCheck {
  ok: boolean;
  mainChannel: ChannelRow | null;
  regionalChannel: ChannelRow | null;
  missing: Array<{
    label: string;
    channel_id: number;
    channel_name: string | null;
    channel_username: string | null;
    display: string;
    status?: string;
    is_member?: boolean;
  }>;
  checkErrors: Array<{
    label: string;
    channel_id: number;
    display: string;
    error: string;
  }>;
}

export async function checkPublishChannelMembership(
  api: Api,
  config: AppConfig,
  userId: number,
  options: {
    regionalChannel: ChannelRow;
    regionalLabel?: string;
  },
): Promise<PublishChannelCheck> {
  const mainChannel = await getMainChannel(config);
  const regionalChannel = options.regionalChannel;
  const regionalLabel = options.regionalLabel?.trim() || regionalChannel.area || '地區頻道';

  const missing: PublishChannelCheck['missing'] = [];
  const checkErrors: PublishChannelCheck['checkErrors'] = [];

  if (!mainChannel) {
    return { ok: false, mainChannel: null, regionalChannel, missing, checkErrors };
  }

  const checks: Array<{ label: string; channel: ChannelRow }> = [
    { label: '總頻', channel: mainChannel },
    { label: regionalLabel, channel: regionalChannel },
  ];

  for (const { label, channel } of checks) {
    const result = await isUserChannelMember(api, userId, channel.channel_id);
    if (result.error) {
      checkErrors.push({
        label,
        channel_id: Number(channel.channel_id),
        display: channelDisplayName(channel),
        error: result.error,
      });
      continue;
    }
    if (!result.joined) {
      missing.push({
        label,
        channel_id: Number(channel.channel_id),
        channel_name: channel.channel_name,
        channel_username: channel.channel_username,
        display: channelDisplayName(channel),
        status: result.status,
        is_member: result.is_member,
      });
    }
  }

  return {
    ok: missing.length === 0 && checkErrors.length === 0,
    mainChannel,
    regionalChannel,
    missing,
    checkErrors,
  };
}

export function formatChannelForTool(channel: ChannelRow) {
  return {
    channel_id: Number(channel.channel_id),
    channel_name: channel.channel_name,
    channel_username: channel.channel_username,
    channel_mode: channel.channel_mode,
    for_post: channel.for_post,
    area: channel.area,
    display: channelDisplayName(channel),
  };
}
