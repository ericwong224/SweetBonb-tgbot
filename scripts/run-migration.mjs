import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const migrationsDir = path.join(import.meta.dirname, 'migrations');
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

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
  multipleStatements: true,
});

function stripLeadingComments(text) {
  return text.replace(/^(\s*--[^\n]*\n)+/, '').trim();
}

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => stripLeadingComments(s.trim()))
    .filter(Boolean);

  for (const stmt of statements) {
    try {
      await c.query(stmt);
      console.log('OK:', stmt.slice(0, 60).replace(/\s+/g, ' ') + '...');
    } catch (err) {
      console.error('FAIL:', stmt.slice(0, 80), err.message);
    }
  }
}

await c.end();
console.log('\nMigration complete.');
