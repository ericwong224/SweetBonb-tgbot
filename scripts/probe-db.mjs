import mysql from 'mysql2/promise';

const host = process.env.DB_HOST ?? 'db-wwferic-do-user-2791833-0.g.db.ondigitalocean.com';
const database = process.env.DB_NAME ?? 'sweetbonb-tgbot';

const c = await mysql.createConnection({
  host,
  port: Number(process.env.DB_PORT ?? 25060),
  user: process.env.DB_USER ?? 'doadmin',
  password: process.env.DB_PASSWORD,
  database,
  ssl: { rejectUnauthorized: false },
});

const [tables] = await c.query('SHOW TABLES');
console.log(JSON.stringify({ database, tables }, null, 2));

for (const row of tables as Array<Record<string, string>>) {
  const name = Object.values(row)[0];
  const [cols] = await c.query(`DESCRIBE \`${name}\``);
  const [count] = await c.query(`SELECT COUNT(*) as cnt FROM \`${name}\``);
  console.log(JSON.stringify({ table: name, columns: cols, count: (count as Array<{ cnt: number }>)[0].cnt }, null, 2));
}

await c.end();
