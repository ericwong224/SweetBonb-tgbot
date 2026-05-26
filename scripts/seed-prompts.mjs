/**
 * Re-apply tg_ai_prompt seeds from 001_tg_flow.sql (idempotent).
 * Usage: DATABASE_URL=... node scripts/seed-prompts.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const migration = path.join(import.meta.dirname, 'run-migration.mjs');
const result = spawnSync(process.execPath, [migration], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
