/**
 * Diagnose channel config + membership checks (all chat_ref variants).
 * DATABASE_URL=... TELEGRAM_BOT_TOKEN=... node scripts/probe-channels.mjs [user_id]
 */

import mysql from 'mysql2/promise';

const userId = process.argv[2] ? Number(process.argv[2]) : null;
const botToken = process.env.TELEGRAM_BOT_TOKEN;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

function normalizeTelegramChatId(channelId) {
  if (typeof channelId === 'string' && channelId.startsWith('@')) return channelId;
  const raw = String(channelId).trim();
  if (raw.startsWith('-')) return raw;
  if (/^\d+$/.test(raw)) {
    if (raw.startsWith('100') && raw.length >= 12) return `-${raw}`;
    if (raw.length >= 9 && raw.length <= 12) return `-100${raw}`;
  }
  return raw;
}

function channelChatRefCandidates(channel) {
  const seen = new Set();
  const out = [];
  const add = (ref) => {
    const key = String(ref);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  if (channel.channel_username?.trim()) {
    add(`@${channel.channel_username.replace(/^@/, '')}`);
  }
  const raw = String(channel.channel_id).trim();
  add(normalizeTelegramChatId(raw));
  if (raw.startsWith('-')) add(raw);
  else if (/^\d+$/.test(raw)) {
    add(raw);
    if (raw.startsWith('100')) add(`-${raw}`);
  }
  return out;
}

const parsed = new URL(url);
parsed.searchParams.delete('ssl-mode');
parsed.searchParams.delete('ssl_mode');

const c = await mysql.createConnection({
  uri: parsed.toString(),
  ssl: { rejectUnauthorized: false },
});

const [channels] = await c.query(
  'SELECT channel_id, channel_name, channel_username, channel_mode, for_post, area FROM n8n_channel_info ORDER BY for_post, channel_id',
);
console.log('\n=== n8n_channel_info ===');
console.table(channels);

if (!botToken) {
  console.log('\n(Set TELEGRAM_BOT_TOKEN to test getChatMember for each channel)');
  await c.end();
  process.exit(0);
}

if (!userId) {
  console.log('\n(Pass telegram user_id as argv to test membership for each channel)');
  await c.end();
  process.exit(0);
}

console.log(`\n=== getChatMember probes for user_id=${userId} ===\n`);

for (const channel of channels) {
  const refs = channelChatRefCandidates(channel);
  console.log(`--- ${channel.channel_name ?? channel.area} (for_post=${channel.for_post}) ---`);
  console.log(`    channel_id=${channel.channel_id} username=${channel.channel_username ?? '(none)'}`);

  for (const ref of refs) {
    const apiUrl = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(ref)}&user_id=${userId}`;
    const res = await fetch(apiUrl);
    const body = await res.json();
    const status = body.ok ? body.result?.status : body.description;
    const joined = body.ok && ['creator', 'administrator', 'member'].includes(body.result?.status);
    console.log(`    ref=${ref} -> ok=${body.ok} status=${status} joined=${joined}`);
  }
  console.log('');
}

await c.end();
