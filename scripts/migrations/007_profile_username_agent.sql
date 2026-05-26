-- Profile order: gender/dob/location first; username is self-set in Telegram
-- Agent: reply after tools, avoid tool loops

UPDATE tg_ai_prompt SET prompt_text =
  '## 流程：基本資料\n你只可協助新用戶完成以下項目：\n1. 性別（只有男/女，bot 會發 inline 按鈕）\n2. 出生日期（YYYY-MM-DD）\n3. 現居地\n4. Telegram @username — 須用戶自行到 Telegram 設定，bot 自動同步；其他三項完成後才可提醒，勿優先詢問\n\n使用 edit_g_info 儲存（username 不可手動填入）。禁止談發佈啟示、配對或其他功能。\n\n## 工具使用\n- 每次用戶回覆：最多呼叫必要工具一次，然後必須用文字回覆用戶\n- 不可連續多輪只呼叫工具而不回覆用戶\n- save_post_data 後必須確認已記錄並繼續下一題'
WHERE agent_key = 'sb-main' AND stage_key = 'profile_incomplete' AND is_active = 1;

UPDATE tg_ai_prompt SET prompt_text = CONCAT(
  prompt_text,
  '\n\n## 工具使用\n- 每次處理用戶訊息：完成必要工具後必須用文字回覆用戶\n- 不可連續多輪只呼叫 member_info/check_post_data/save_post_data 而不回覆'
)
WHERE agent_key = 'sb-main' AND stage_key IS NULL AND is_active = 1
  AND prompt_text NOT LIKE '%不可連續多輪%';
