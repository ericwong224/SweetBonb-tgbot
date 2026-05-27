/**
 * One-time migration: legacy `users` + `n8n_post_data` → tg_* tables.
 *
 * Usage:
 *   DATABASE_URL=mysql://... node scripts/migrate-legacy-users.mjs
 *   DATABASE_URL=... node scripts/migrate-legacy-users.mjs --dry-run
 *   DATABASE_URL=... node scripts/migrate-legacy-users.mjs --user-id=123456
 */
import mysql from 'mysql2/promise';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const userIdArg = args.find((a) => a.startsWith('--user-id='));
const onlyUserId = userIdArg ? Number(userIdArg.split('=')[1]) : null;

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

const stats = {
  usersScanned: 0,
  profilesInserted: 0,
  profilesUpdated: 0,
  postResponsesInserted: 0,
  postResponsesUpdated: 0,
  userPostsInserted: 0,
  userPostsUpdated: 0,
  flowsUpserted: 0,
};

function pickString(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function formatDob(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isCoreComplete(profile) {
  return Boolean(profile.gender && profile.dob && pickString(profile.location));
}

function isFullProfile(profile) {
  return isCoreComplete(profile) && pickString(profile.telegram_username);
}

async function getTableColumns(table) {
  const [rows] = await c.query(`SHOW COLUMNS FROM \`${table}\``);
  return new Set(rows.map((r) => r.Field));
}

async function loadFieldDefs() {
  const [rows] = await c.query(
    'SELECT field_key, required FROM tg_post_field_def WHERE active = 1',
  );
  const keys = new Set(rows.map((r) => r.field_key));
  const required = rows.filter((r) => r.required === 1).map((r) => r.field_key);
  return { keys, required };
}

async function loadLegacyPostData(userId) {
  const [rows] = await c.query(
    `SELECT item, content FROM n8n_post_data
     WHERE user_id = ?
     ORDER BY update_datetime DESC, post_data_id DESC`,
    [userId],
  );
  const map = {};
  for (const row of rows) {
    const item = String(row.item);
    if (map[item] == null && String(row.content ?? '').trim()) {
      map[item] = String(row.content).trim();
    }
  }
  return map;
}

function resolveStage(profile, postData, requiredFields, postStatus) {
  if (!isCoreComplete(profile)) return 'profile_incomplete';
  const missing = requiredFields.filter((k) => !postData[k]?.trim());
  if (missing.length > 0) return 'profile_complete';
  if (postStatus === 'publish') return 'post_published';
  return 'post_ready';
}

async function migrateProfile(legacy, existing, userColumns) {
  const merged = {
    telegram_username: force
      ? pickString(legacy.username)
      : pickString(existing?.telegram_username, legacy.username),
    gender: force ? legacy.gender ?? null : existing?.gender ?? legacy.gender ?? null,
    dob: force ? formatDob(legacy.dob) : formatDob(existing?.dob ?? legacy.dob),
    location: force
      ? pickString(legacy.location)
      : pickString(existing?.location, legacy.location),
    last_online: legacy.last_online ?? existing?.last_online ?? null,
    acc_active: legacy.acc_block === 1 ? 0 : legacy.acc_active === 0 ? 0 : 1,
    completed_at: null,
  };

  if (isFullProfile(merged)) {
    merged.completed_at = existing?.completed_at ?? new Date();
  } else if (existing?.completed_at) {
    merged.completed_at = existing.completed_at;
  }

  const inserted = !existing;

  if (dryRun) {
    if (inserted) stats.profilesInserted += 1;
    else stats.profilesUpdated += 1;
    return merged;
  }

  if (inserted) {
    await c.query(
      `INSERT INTO tg_user_profile
       (user_id, telegram_username, gender, dob, location, last_online, acc_active, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        legacy.user_id,
        merged.telegram_username,
        merged.gender,
        merged.dob,
        merged.location,
        merged.last_online,
        merged.acc_active,
        merged.completed_at,
      ],
    );
    stats.profilesInserted += 1;
  } else {
    await c.query(
      `UPDATE tg_user_profile SET
         telegram_username = ?,
         gender = ?,
         dob = ?,
         location = ?,
         last_online = COALESCE(?, last_online),
         acc_active = ?,
         completed_at = ?
       WHERE user_id = ?`,
      [
        merged.telegram_username,
        merged.gender,
        merged.dob,
        merged.location,
        merged.last_online,
        merged.acc_active,
        merged.completed_at,
        legacy.user_id,
      ],
    );
    stats.profilesUpdated += 1;
  }

  return merged;
}

async function migratePostResponses(userId, legacyPost, existingPost, fieldKeys) {
  let inserted = 0;
  let updated = 0;

  for (const [fieldKey, content] of Object.entries(legacyPost)) {
    if (!fieldKeys.has(fieldKey)) continue;
    const trimmed = content.trim();
    if (!trimmed) continue;

    const hasExisting = Object.prototype.hasOwnProperty.call(existingPost, fieldKey);
    const existingVal = existingPost[fieldKey]?.trim() ?? '';

    if (hasExisting && existingVal && !force) continue;

    if (dryRun) {
      if (hasExisting) updated += 1;
      else inserted += 1;
      continue;
    }

    await c.query(
      `INSERT INTO tg_post_response (user_id, field_key, content)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), updated_at = NOW()`,
      [userId, fieldKey, trimmed],
    );
    if (hasExisting) updated += 1;
    else inserted += 1;
    existingPost[fieldKey] = trimmed;
  }

  stats.postResponsesInserted += inserted;
  stats.postResponsesUpdated += updated;
  return existingPost;
}

async function migrateUserPost(userId, legacy, existingPost, userColumns) {
  const hasPostData =
    legacy.post_on === 'publish' ||
    pickString(legacy.post_format_2) ||
    (userColumns.has('post_format_1') && pickString(legacy.post_format_1)) ||
    legacy.post_channel_id != null;

  if (!hasPostData && existingPost) return existingPost?.status ?? 'draft';

  const status = legacy.post_on === 'publish' ? 'publish' : legacy.post_on ?? 'draft';
  const bodyFormat = pickString(existingPost?.body_format, legacy.post_format_2);
  const bodyShort = userColumns.has('post_format_1')
    ? pickString(existingPost?.body_short, legacy.post_format_1)
    : pickString(existingPost?.body_short);
  const channelId = existingPost?.channel_id ?? legacy.post_channel_id ?? null;

  if (dryRun) {
    if (existingPost) stats.userPostsUpdated += 1;
    else stats.userPostsInserted += 1;
    return status;
  }

  await c.query(
    `INSERT INTO tg_user_post (user_id, status, body_format, body_short, channel_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = CASE
         WHEN tg_user_post.status = 'publish' OR VALUES(status) = 'publish' THEN 'publish'
         ELSE COALESCE(NULLIF(VALUES(status), ''), tg_user_post.status)
       END,
       body_format = COALESCE(tg_user_post.body_format, VALUES(body_format)),
       body_short = COALESCE(tg_user_post.body_short, VALUES(body_short)),
       channel_id = COALESCE(tg_user_post.channel_id, VALUES(channel_id))`,
    [userId, status, bodyFormat, bodyShort, channelId],
  );

  if (existingPost) stats.userPostsUpdated += 1;
  else stats.userPostsInserted += 1;

  return status === 'publish' ? 'publish' : existingPost?.status ?? status;
}

async function upsertFlow(userId, stage) {
  if (dryRun) {
    stats.flowsUpserted += 1;
    return;
  }
  await c.query(
    `INSERT INTO tg_user_flow (user_id, stage) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE stage = VALUES(stage), updated_at = NOW()`,
    [userId, stage],
  );
  stats.flowsUpserted += 1;
}

async function main() {
  const userColumns = await getTableColumns('users');
  const tgPostColumns = await getTableColumns('tg_user_post');
  const { keys: fieldKeys, required: requiredFields } = await loadFieldDefs();

  if (!tgPostColumns.has('body_short')) {
    console.warn('Warning: tg_user_post.body_short missing — run migration 010 first.');
  }

  let usersQuery = 'SELECT * FROM users';
  const params = [];
  if (onlyUserId) {
    usersQuery += ' WHERE user_id = ?';
    params.push(onlyUserId);
  }
  usersQuery += ' ORDER BY user_id';

  const [users] = await c.query(usersQuery, params);
  console.log(
    `${dryRun ? '[DRY RUN] ' : ''}Migrating ${users.length} legacy user(s)... (force=${force})`,
  );

  for (const legacy of users) {
    stats.usersScanned += 1;
    const userId = legacy.user_id;

    const [[existingProfile]] = await c.query(
      'SELECT * FROM tg_user_profile WHERE user_id = ? LIMIT 1',
      [userId],
    );
    const profile = await migrateProfile(legacy, existingProfile ?? null, userColumns);

    const legacyPost = await loadLegacyPostData(userId);
    const hasLegacyPost = Object.keys(legacyPost).length > 0;

    let postMap = {};
    if (hasLegacyPost || force) {
      const [existingResponses] = await c.query(
        'SELECT field_key, content FROM tg_post_response WHERE user_id = ?',
        [userId],
      );
      for (const row of existingResponses) {
        postMap[row.field_key] = String(row.content);
      }
      postMap = await migratePostResponses(userId, legacyPost, postMap, fieldKeys);
    } else {
      const [existingResponses] = await c.query(
        'SELECT field_key, content FROM tg_post_response WHERE user_id = ?',
        [userId],
      );
      for (const row of existingResponses) {
        postMap[row.field_key] = String(row.content);
      }
    }

    const [[existingUserPost]] = await c.query(
      'SELECT * FROM tg_user_post WHERE user_id = ? LIMIT 1',
      [userId],
    );

    const postStatus = await migrateUserPost(
      userId,
      legacy,
      existingUserPost ?? null,
      userColumns,
    );

    const stage = resolveStage(profile, postMap, requiredFields, postStatus);
    await upsertFlow(userId, stage);
  }

  console.log(JSON.stringify(stats, null, 2));
  await c.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await c.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
