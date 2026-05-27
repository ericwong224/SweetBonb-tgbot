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

const NOT_JOINED_STATUSES = new Set(['left', 'kicked', 'banned']);

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
    // Some legacy rows store the supergroup id without the -100 prefix.
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

/**
 * Match user location (e.g. 香港-九龍) to a regional post channel.
 * Bidirectional: channel.area contained in location OR location contained in channel.area.
 */
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
       AND (
         area LIKE ?
         OR ? LIKE CONCAT('%', area, '%')
       )
     ORDER BY LENGTH(area) DESC, channel_id
     LIMIT 1`,
    [`%${trimmed}%`, trimmed],
  );
  return rows[0] ?? null;
}

export interface ChannelMemberCheck {
  joined: boolean;
  status?: string;
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
    const joined = !NOT_JOINED_STATUSES.has(member.status);
    return { joined, status: member.status };
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
  location: string,
): Promise<PublishChannelCheck> {
  const mainChannel = await getMainChannel(config);
  const regionalChannel = await getRegionalChannel(config, location);

  const missing: PublishChannelCheck['missing'] = [];
  const checkErrors: PublishChannelCheck['checkErrors'] = [];

  if (!mainChannel) {
    return { ok: false, mainChannel: null, regionalChannel, missing, checkErrors };
  }
  if (!regionalChannel) {
    return { ok: false, mainChannel, regionalChannel: null, missing, checkErrors };
  }

  const checks: Array<{ label: string; channel: ChannelRow }> = [
    { label: '總頻', channel: mainChannel },
    { label: location, channel: regionalChannel },
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
