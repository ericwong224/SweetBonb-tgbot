-- Publish flow: require main + regional channel membership; dual publish

UPDATE tg_ai_prompt SET is_active = 0
WHERE agent_key = 'sb-main' AND stage_key = 'post_ready' AND is_active = 1;

INSERT INTO tg_ai_prompt (agent_key, stage_key, prompt_text, version, is_active)
SELECT 'sb-main', 'post_ready',
  '## 流程：確認發佈
啟示問卷已齊。發佈前必須：
1. 用 check_member 確認用戶已加入「總頻」及居住地對應的地區頻道（可先 channel_info 查頻道 ID）。
2. 若未加入，請提供頻道 @username 或連結，請用戶加入後再發佈。
3. 用戶確認預覽後，使用 post2publish：
   - 詳細啟示 → 地區頻道
   - 簡短啟示 → 總頻（附「查看詳細啟示」按鈕連至地區頻道）',
  COALESCE((SELECT MAX(version) + 1 FROM tg_ai_prompt p WHERE p.agent_key = 'sb-main' AND p.stage_key = 'post_ready'), 1),
  1;
