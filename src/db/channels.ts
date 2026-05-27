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

export function channelDisplayName(channel: ChannelRow): string {
  if (channel.channel_username?.trim()) {
    return `@${channel.channel_username.replace(/^@/, '')}`;
  }
  return channel.channel_name?.trim() || String(channel.channel_id);
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
     WHERE for_post = 0
        OR channel_mode IN ('main', 'master', '總頻')
        OR area IN ('總頻', '總', 'Main', 'ALL')
     ORDER BY
       CASE
         WHEN channel_mode IN ('main', 'master') THEN 0
         WHEN area LIKE '%總%' THEN 1
         WHEN for_post = 0 THEN 2
         ELSE 3
       END,
       channel_id
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getRegionalChannel(
  config: AppConfig,
  area: string,
): Promise<ChannelRow | null> {
  const rows = await query<ChannelRow[]>(
    config,
    'SELECT * FROM n8n_channel_info WHERE area LIKE ? AND for_post = 1 LIMIT 1',
    [`%${area}%`],
  );
  return rows[0] ?? null;
}

export async function isUserChannelMember(
  api: Api,
  userId: number,
  channelId: number | bigint,
): Promise<boolean> {
  try {
    const member = await api.getChatMember(Number(channelId), userId);
    return !['left', 'kicked', 'banned'].includes(member.status);
  } catch {
    return false;
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

  if (!mainChannel) {
    return { ok: false, mainChannel: null, regionalChannel, missing };
  }
  if (!regionalChannel) {
    return { ok: false, mainChannel, regionalChannel: null, missing };
  }

  const checks: Array<{ label: string; channel: ChannelRow }> = [
    { label: '總頻', channel: mainChannel },
    { label: location, channel: regionalChannel },
  ];

  for (const { label, channel } of checks) {
    const joined = await isUserChannelMember(api, userId, channel.channel_id);
    if (!joined) {
      missing.push({
        label,
        channel_id: Number(channel.channel_id),
        channel_name: channel.channel_name,
        channel_username: channel.channel_username,
        display: channelDisplayName(channel),
      });
    }
  }

  return {
    ok: missing.length === 0,
    mainChannel,
    regionalChannel,
    missing,
  };
}
