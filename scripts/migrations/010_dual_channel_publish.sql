-- Dual-channel publish: short post on main channel, detailed on regional channel

ALTER TABLE tg_user_post
  ADD COLUMN body_short MEDIUMTEXT NULL AFTER body_format;

ALTER TABLE tg_user_post
  ADD COLUMN main_channel_id BIGINT NULL AFTER channel_message_id;

ALTER TABLE tg_user_post
  ADD COLUMN main_channel_message_id BIGINT NULL AFTER main_channel_id;
