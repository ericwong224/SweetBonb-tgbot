/**
 * Diagnose channel config + membership checks.
 * DATABASE_URL=... node scripts/probe-channels.mjs [user_id]
 */
import mysql from 'mysql2/promise';

const userId = process.argv[2] ? Number(process.argv[2]) : null;
const botToken = process.env.TELEGRAM_BOT_TOKEN;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
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

const [mainRows] = await c.query(
  `SELECT channel_id, channel_name, area, for_post, channel_mode FROM n8n_channel_info
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
   LIMIT 3`,
);
console.log('\n=== getMainChannel candidates ===');
console.table(mainRows);

if (userId) {
  const [[user]] = await c.query('SELECT user_id, location FROM users WHERE user_id = ? LIMIT 1', [
    userId,
  ]);
  const [[profile]] = await c.query(
    'SELECT user_id, location FROM tg_user_profile WHERE user_id = ? LIMIT 1',
    [userId],
  );
  const location = profile?.location ?? user?.location;
  console.log('\n=== user location ===', location ?? '(none)');

  if (location) {
    const [oldMatch] = await c.query(
      'SELECT channel_id, channel_name, area FROM n8n_channel_info WHERE area LIKE ? AND for_post = 1',
      [`%${location}%`],
    );
    console.log('\n=== OLD match (area LIKE %location%) ===');
    console.table(oldMatch);

    const [newMatch] = await c.query(
      `SELECT channel_id, channel_name, area FROM n8n_channel_info
       WHERE for_post = 1 AND (area LIKE ? OR ? LIKE CONCAT('%', area, '%'))
       ORDER BY LENGTH(area) DESC`,
      [`%${location}%`, location],
    );
    console.log('\n=== NEW match (bidirectional) ===');
    console.table(newMatch);
  }
}

if (botToken && userId && mainRows[0]) {
  const channelId = mainRows[0].channel_id;
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${channelId}&user_id=${userId}`,
  );
  const body = await res.json();
  console.log('\n=== getChatMember (main channel) ===');
  console.log(JSON.stringify(body, null, 2));
} else if (userId) {
  console.log('\n(Set TELEGRAM_BOT_TOKEN to test getChatMember live)');
}

await c.end();
