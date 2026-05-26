import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.DB_HOST ?? 'db-wwferic-do-user-2791833-0.g.db.ondigitalocean.com',
  port: Number(process.env.DB_PORT ?? 25060),
  user: process.env.DB_USER ?? 'doadmin',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'sweetbonb-tgbot',
  ssl: { rejectUnauthorized: false },
});

await c.query(
  "ALTER TABLE n8n_bot_info MODIFY bot_mode ENUM('live','test','demo','admin') NULL",
);

const [existing] = await c.query("SELECT bot_id FROM n8n_bot_info WHERE bot_mode = 'demo' LIMIT 1");
if (existing.length === 0) {
  await c.query(`
    INSERT INTO n8n_bot_info (bot_mode, bot_username, bot_token, bot_admin_id)
    SELECT 'demo', bot_username, bot_token, bot_admin_id
    FROM n8n_bot_info
    WHERE bot_mode = 'test'
    LIMIT 1
  `);
  console.log('Inserted demo row (copied from test bot).');
} else {
  console.log('Demo row already exists.');
}

const [rows] = await c.query(
  'SELECT bot_id, bot_mode, bot_username FROM n8n_bot_info ORDER BY bot_id',
);
console.log(JSON.stringify(rows, null, 2));
await c.end();
