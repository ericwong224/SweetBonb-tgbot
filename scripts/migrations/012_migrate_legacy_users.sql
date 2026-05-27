-- Bulk migrate legacy users → tg_* (idempotent; fills gaps, does not overwrite existing tg data)
-- Prefer running: node scripts/migrate-legacy-users.mjs (handles edge cases + reports stats)
-- This SQL is a fallback for the same operation.

-- 1) Basic profile: users → tg_user_profile
INSERT INTO tg_user_profile (user_id, telegram_username, gender, dob, location, last_online, acc_active, completed_at)
SELECT
  u.user_id,
  NULLIF(TRIM(u.username), ''),
  u.gender,
  u.dob,
  NULLIF(TRIM(u.location), ''),
  u.last_online,
  CASE WHEN u.acc_block = 1 THEN 0 ELSE COALESCE(u.acc_active, 1) END,
  CASE
    WHEN u.gender IS NOT NULL AND u.dob IS NOT NULL
      AND u.location IS NOT NULL AND TRIM(u.location) != ''
      AND u.username IS NOT NULL AND TRIM(u.username) != ''
    THEN NOW()
    ELSE NULL
  END
FROM users u
ON DUPLICATE KEY UPDATE
  telegram_username = COALESCE(NULLIF(TRIM(tg_user_profile.telegram_username), ''), NULLIF(TRIM(VALUES(telegram_username)), '')),
  gender = COALESCE(tg_user_profile.gender, VALUES(gender)),
  dob = COALESCE(tg_user_profile.dob, VALUES(dob)),
  location = COALESCE(NULLIF(TRIM(tg_user_profile.location), ''), NULLIF(TRIM(VALUES(location)), '')),
  last_online = GREATEST(COALESCE(tg_user_profile.last_online, '1970-01-01'), COALESCE(VALUES(last_online), '1970-01-01')),
  acc_active = VALUES(acc_active),
  completed_at = COALESCE(tg_user_profile.completed_at, VALUES(completed_at));

-- 2) Post questionnaire: n8n_post_data → tg_post_response (latest row per item)
INSERT INTO tg_post_response (user_id, field_key, content)
SELECT d.user_id, d.item, d.content
FROM (
  SELECT
    n.user_id,
    n.item,
    n.content,
    ROW_NUMBER() OVER (
      PARTITION BY n.user_id, n.item
      ORDER BY n.update_datetime DESC, n.post_data_id DESC
    ) AS rn
  FROM n8n_post_data n
) d
INNER JOIN tg_post_field_def f ON f.field_key = d.item AND f.active = 1
WHERE d.rn = 1 AND TRIM(d.content) != ''
ON DUPLICATE KEY UPDATE
  content = COALESCE(NULLIF(TRIM(tg_post_response.content), ''), VALUES(content)),
  updated_at = NOW();

-- 3) Post draft/publish state: users → tg_user_post
INSERT INTO tg_user_post (user_id, status, body_format, body_short, channel_id)
SELECT
  u.user_id,
  CASE WHEN u.post_on = 'publish' THEN 'publish' ELSE COALESCE(u.post_on, 'draft') END,
  u.post_format_2,
  u.post_format_1,
  u.post_channel_id
FROM users u
WHERE u.post_on = 'publish'
   OR u.post_format_2 IS NOT NULL
   OR u.post_format_1 IS NOT NULL
   OR u.post_channel_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM n8n_post_data p WHERE p.user_id = u.user_id)
ON DUPLICATE KEY UPDATE
  status = CASE
    WHEN tg_user_post.status = 'publish' OR VALUES(status) = 'publish' THEN 'publish'
    ELSE COALESCE(NULLIF(VALUES(status), ''), tg_user_post.status)
  END,
  body_format = COALESCE(tg_user_post.body_format, VALUES(body_format)),
  body_short = COALESCE(tg_user_post.body_short, VALUES(body_short)),
  channel_id = COALESCE(tg_user_post.channel_id, VALUES(channel_id));

-- 4) Flow stage from migrated profile + responses + publish status
INSERT INTO tg_user_flow (user_id, stage)
SELECT
  u.user_id,
  CASE
    WHEN p.gender IS NULL OR p.dob IS NULL OR p.location IS NULL OR TRIM(p.location) = ''
      THEN 'profile_incomplete'
    WHEN (
      SELECT COUNT(*)
      FROM tg_post_field_def f
      WHERE f.required = 1 AND f.active = 1
        AND NOT EXISTS (
          SELECT 1 FROM tg_post_response r
          WHERE r.user_id = u.user_id AND r.field_key = f.field_key AND TRIM(r.content) != ''
        )
    ) > 0
      THEN 'profile_complete'
    WHEN COALESCE(up.status, u.post_on) = 'publish'
      THEN 'post_published'
    ELSE 'post_ready'
  END
FROM users u
LEFT JOIN tg_user_profile p ON p.user_id = u.user_id
LEFT JOIN tg_user_post up ON up.user_id = u.user_id
ON DUPLICATE KEY UPDATE
  stage = VALUES(stage),
  updated_at = NOW();
