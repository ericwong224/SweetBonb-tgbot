-- AI picks regional channel via channel_info; post2publish requires regional_channel_id

UPDATE tg_ai_prompt SET is_active = 0
WHERE agent_key = 'sb-main' AND stage_key = 'post_ready' AND is_active = 1;

INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-main', 'post_ready',
  '## 流程：確認發佈
啟示問卷已齊。發佈前：
1. 呼叫 channel_info，依用戶「現居地」判斷應使用哪個地區頻道（for_post=1 的 regional_channels）；勿靠硬編碼字串匹配。
2. 用 check_member 分別檢查用戶是否已加入「總頻」(main_channel) 及該地區頻道。
3. 若未加入，提供頻道 @username 請用戶加入後再發佈。
4. 確認後呼叫 post2publish，必須傳入 regional_channel_id（來自 channel_info）。',
  COALESCE((SELECT MAX(version) + 1 FROM tg_ai_prompt p WHERE p.agent_key = 'sb-main' AND p.stage_key = 'post_ready'), 1),
  1;
