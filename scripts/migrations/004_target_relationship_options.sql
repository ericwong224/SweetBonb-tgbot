-- Narrow target_relationship options to four labeled choices

UPDATE tg_post_field_def SET
  options_json = '["SP-只有性","FWB-有性有愛","SL-陪伴為主","情侶-長遠發展"]'
WHERE field_key = 'target_relationship';
