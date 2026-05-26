-- SweetBonb TG bot flow tables (run once on sweetbonb-tgbot database)

CREATE TABLE IF NOT EXISTS tg_user_profile (
  user_id BIGINT NOT NULL PRIMARY KEY,
  telegram_username VARCHAR(255) NULL,
  gender ENUM('M', 'F') NULL,
  dob DATE NULL,
  location VARCHAR(255) NULL,
  last_online DATETIME NULL,
  acc_active TINYINT(1) NOT NULL DEFAULT 1,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tg_user_flow (
  user_id BIGINT NOT NULL PRIMARY KEY,
  stage ENUM('profile_incomplete', 'profile_complete', 'post_ready', 'post_published') NOT NULL DEFAULT 'profile_incomplete',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tg_post_field_def (
  field_key VARCHAR(64) NOT NULL PRIMARY KEY,
  label_zh VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  required TINYINT(1) NOT NULL DEFAULT 1,
  hint TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tg_post_response (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  field_key VARCHAR(64) NOT NULL,
  content TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_field (user_id, field_key),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tg_user_post (
  user_id BIGINT NOT NULL PRIMARY KEY,
  status ENUM('draft', 'on-hold', 'publish') NOT NULL DEFAULT 'draft',
  body_format MEDIUMTEXT NULL,
  channel_id BIGINT NULL,
  channel_message_id BIGINT NULL,
  published_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tg_match (
  match_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  initiator_id BIGINT NOT NULL,
  target_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'request',
  initiator_snapshot MEDIUMTEXT NULL,
  target_snapshot MEDIUMTEXT NULL,
  analyze_data MEDIUMTEXT NULL,
  match_rate INT NULL,
  target_msg_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_target (target_id, status),
  KEY idx_initiator (initiator_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tg_ai_prompt (
  prompt_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agent_key VARCHAR(32) NOT NULL,
  stage_key VARCHAR(32) NULL,
  prompt_text MEDIUMTEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_agent_stage (agent_key, stage_key, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tg_chat_message (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  bot_handle VARCHAR(64) NOT NULL,
  role ENUM('user', 'assistant', 'system') NOT NULL,
  msg_type VARCHAR(32) NOT NULL,
  msg_status ENUM('waiting', 'done', 'del-whole') NOT NULL DEFAULT 'done',
  content MEDIUMTEXT NOT NULL,
  stage_key VARCHAR(32) NULL,
  agent_key VARCHAR(32) NULL,
  chat_id BIGINT NULL,
  message_id BIGINT NULL,
  sysmsg TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_bot (user_id, bot_handle, msg_status, created_at),
  KEY idx_cleanup (bot_handle, msg_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tg_user_lock (
  user_id BIGINT NOT NULL PRIMARY KEY,
  locked_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed post field defs from legacy N8N table when empty
INSERT INTO tg_post_field_def (field_key, label_zh, sort_order, required, active)
SELECT item_name, item_name, ROW_NUMBER() OVER (ORDER BY item_name), 1, 1
FROM n8n_post_data_item
WHERE NOT EXISTS (SELECT 1 FROM tg_post_field_def LIMIT 1);

-- Seed sb-main base prompt from legacy if empty
INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-main', NULL, LEFT(s.sysmsg, 65000), 1, 1
FROM n8n_ai_agent_sysmsg s
JOIN n8n_ai_agent a ON a.ai_agent_id = s.ai_agent_id
WHERE a.ai_agent_function = 'sb-main'
  AND NOT EXISTS (SELECT 1 FROM tg_ai_prompt WHERE agent_key = 'sb-main' AND stage_key IS NULL)
ORDER BY s.ver DESC, s.sysmsg_id DESC
LIMIT 1;

INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-match', NULL, LEFT(s.sysmsg, 65000), 1, 1
FROM n8n_ai_agent_sysmsg s
JOIN n8n_ai_agent a ON a.ai_agent_id = s.ai_agent_id
WHERE a.ai_agent_function = 'sb-match'
  AND NOT EXISTS (SELECT 1 FROM tg_ai_prompt WHERE agent_key = 'sb-match' AND stage_key IS NULL)
ORDER BY s.ver DESC, s.sysmsg_id DESC
LIMIT 1;

INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-admin', NULL, LEFT(s.sysmsg, 65000), 1, 1
FROM n8n_ai_agent_sysmsg s
JOIN n8n_ai_agent a ON a.ai_agent_id = s.ai_agent_id
WHERE a.ai_agent_function = 'sb-admin'
  AND NOT EXISTS (SELECT 1 FROM tg_ai_prompt WHERE agent_key = 'sb-admin' AND stage_key IS NULL)
ORDER BY s.ver DESC, s.sysmsg_id DESC
LIMIT 1;

-- Stage overlay prompts (only if missing)
INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-main', 'profile_incomplete',
  '## 流程：基本資料\n你只可協助新用戶完成以下四項（逐項詢問，不可跳過）：\n1. Telegram @username\n2. 性別（男/女）\n3. 出生日期（YYYY-MM-DD）\n4. 現居地\n使用 edit_g_info 儲存。禁止談發佈啟示、配對或其他功能。若無 @username，請引導用戶到 Telegram 設定。',
  1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM tg_ai_prompt p
  WHERE p.agent_key = 'sb-main' AND p.stage_key = 'profile_incomplete' AND p.is_active = 1
);

INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-main', 'profile_complete',
  '## 流程：填寫啟示問卷\n基本資料已完成。請用 save_post_data 逐項收集啟示問卷（可先 check_post_data 看缺什麼）。禁止發佈或配對，直至問卷齊全。',
  1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM tg_ai_prompt p
  WHERE p.agent_key = 'sb-main' AND p.stage_key = 'profile_complete' AND p.is_active = 1
);

INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-main', 'post_ready',
  '## 流程：確認發佈\n啟示問卷已齊。請讓用戶確認預覽後，使用 post2publish 發佈到頻道。',
  1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM tg_ai_prompt p
  WHERE p.agent_key = 'sb-main' AND p.stage_key = 'post_ready' AND p.is_active = 1
);

INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-main', 'post_published',
  '## 流程：已發佈\n用戶啟示已發佈，可回答配對相關問題。',
  1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM tg_ai_prompt p
  WHERE p.agent_key = 'sb-main' AND p.stage_key = 'post_published' AND p.is_active = 1
);
