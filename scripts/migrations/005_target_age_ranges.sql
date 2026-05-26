-- Target age: range (18-20) or minimum (20+) inline options

UPDATE tg_post_field_def SET
  label_zh = '期望對象年齡',
  field_type = 'choice',
  options_json = '["18-20","21-25","26-30","31-35","36-40","41-45","46-50","20+","25+","30+","35+","40+","45+","50+"]',
  hint = '範圍如 18-20；以上如 20+（即 20 歲或以上）'
WHERE field_key = 'target_age';
