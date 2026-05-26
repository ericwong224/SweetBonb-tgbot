-- User preferred reply language

ALTER TABLE tg_user_profile
  ADD COLUMN preferred_language ENUM('zh-spoken', 'zh-written', 'en') NULL
  AFTER location;
