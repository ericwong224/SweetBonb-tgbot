-- Remind AI not to use Markdown (bot sends plain text)

UPDATE tg_ai_prompt SET prompt_text = CONCAT(
  prompt_text,
  '\n\n## 回覆格式\n- 不要使用 Markdown（不要用 **粗體** 或星號）。\n- 選擇題由 bot 自動發 inline 按鈕，只需引導用戶點按鈕。'
)
WHERE agent_key = 'sb-main' AND stage_key IS NULL AND is_active = 1
  AND prompt_text NOT LIKE '%回覆格式%';
