import mysql from 'mysql2/promise';

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

const [tables] = await c.query("SHOW TABLES LIKE 'tg_%'");
console.log('tg tables:', tables.map((r) => Object.values(r)[0]));

for (const table of ['tg_ai_prompt', 'tg_post_field_def', 'tg_user_profile']) {
  const [rows] = await c.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  console.log(table, 'count:', rows[0].c);
}

const [ver] = await c.query(`
  SELECT MAX(s.ver) AS m FROM n8n_ai_agent_sysmsg s
  JOIN n8n_ai_agent a ON a.ai_agent_id = s.ai_agent_id
  WHERE a.ai_agent_function = 'sb-main'
`);
console.log('max sb-main ver:', ver[0].m);

await c.end();
