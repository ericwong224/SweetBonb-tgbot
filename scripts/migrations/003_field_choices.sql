-- Choice field options for inline button pickers

ALTER TABLE tg_post_field_def
  ADD COLUMN field_type ENUM('text', 'choice') NOT NULL DEFAULT 'text' AFTER label_zh,
  ADD COLUMN options_json JSON NULL AFTER field_type;

UPDATE tg_post_field_def SET
  label_zh = '可接受性趣問卷',
  field_type = 'text'
WHERE field_key = 'acceptance_questionnaire';

UPDATE tg_post_field_def SET label_zh = '身高 (cm)', field_type = 'text' WHERE field_key = 'member_height';
UPDATE tg_post_field_def SET label_zh = '個人簡介', field_type = 'text' WHERE field_key = 'member_profile';
UPDATE tg_post_field_def SET
  label_zh = '感情狀況',
  field_type = 'choice',
  options_json = '["單身","戀愛中","已婚","離婚","離異"]'
WHERE field_key = 'member_relationship_status';

UPDATE tg_post_field_def SET label_zh = '性經驗', field_type = 'text' WHERE field_key = 'member_sexual_experience';
UPDATE tg_post_field_def SET label_zh = '體重 (kg)', field_type = 'text' WHERE field_key = 'member_weight';
UPDATE tg_post_field_def SET label_zh = '其他性趣', field_type = 'text' WHERE field_key = 'other_sexual_interests';
UPDATE tg_post_field_def SET
  label_zh = '安全配對設定',
  field_type = 'choice',
  options_json = '["顯示用戶名","不顯示用戶名"]'
WHERE field_key = 'secure_pairing_options';

UPDATE tg_post_field_def SET label_zh = '期望對象年齡', field_type = 'text' WHERE field_key = 'target_age';
UPDATE tg_post_field_def SET label_zh = '期望對象身形', field_type = 'text' WHERE field_key = 'target_bodyshape';
UPDATE tg_post_field_def SET
  label_zh = '尋找對象性別',
  field_type = 'choice',
  options_json = '["男","女"]'
WHERE field_key = 'target_gender';

UPDATE tg_post_field_def SET label_zh = '期望對象身高', field_type = 'text' WHERE field_key = 'target_height';
UPDATE tg_post_field_def SET
  label_zh = '期望關係類型',
  field_type = 'choice',
  options_json = '["SP-只有性","FWB-有性有愛","SL-陪伴為主","情侶-長遠發展"]'
WHERE field_key = 'target_relationship';

UPDATE tg_post_field_def SET
  label_zh = '期望對象感情狀況',
  field_type = 'choice',
  options_json = '["不限","單身","已婚"]'
WHERE field_key = 'target_relationship_status';

UPDATE tg_ai_prompt SET prompt_text = CONCAT(
  prompt_text,
  '\n\n## 選擇題規則\n- 性別只有「男」或「女」，沒有其他選項，必須選一。\n- 問卷中的選擇題由 bot 發送 inline 按鈕，請引導用戶點按鈕選擇，不要列出選項讓用戶打字。\n- 自由填寫題（簡介、身高等）才用對話收集。'
)
WHERE agent_key = 'sb-main' AND stage_key IS NULL AND is_active = 1
  AND prompt_text NOT LIKE '%選擇題規則%';

UPDATE tg_ai_prompt SET prompt_text =
  '## 流程：基本資料\n你只可協助新用戶完成以下四項（逐項詢問，不可跳過）：\n1. Telegram @username\n2. 性別（只有男/女，必須選一；bot 會發 inline 按鈕）\n3. 出生日期（YYYY-MM-DD）\n4. 現居地\n使用 edit_g_info 儲存。禁止談發佈啟示、配對或其他功能。若無 @username，請引導用戶到 Telegram 設定。'
WHERE agent_key = 'sb-main' AND stage_key = 'profile_incomplete' AND is_active = 1;

UPDATE tg_ai_prompt SET prompt_text =
  '## 流程：填寫啟示問卷\n基本資料已完成。選擇題由 bot 發 inline 按鈕；自由填寫題用 save_post_data 收集（可先 check_post_data 看缺什麼）。禁止發佈或配對，直至問卷齊全。'
WHERE agent_key = 'sb-main' AND stage_key = 'profile_complete' AND is_active = 1;
