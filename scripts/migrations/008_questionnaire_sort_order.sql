-- Canonical questionnaire order (tg_post_field_def.sort_order).
-- Bot reads sort_order from DB; adjust here to reorder questions without code changes.

UPDATE tg_post_field_def SET sort_order =  1 WHERE field_key = 'target_gender';
UPDATE tg_post_field_def SET sort_order =  2 WHERE field_key = 'target_relationship';
UPDATE tg_post_field_def SET sort_order =  3 WHERE field_key = 'target_age';
UPDATE tg_post_field_def SET sort_order =  4 WHERE field_key = 'target_height';
UPDATE tg_post_field_def SET sort_order =  5 WHERE field_key = 'target_relationship_status';
UPDATE tg_post_field_def SET sort_order =  6 WHERE field_key = 'target_bodyshape';
UPDATE tg_post_field_def SET sort_order =  7 WHERE field_key = 'member_height';
UPDATE tg_post_field_def SET sort_order =  8 WHERE field_key = 'member_weight';
UPDATE tg_post_field_def SET sort_order =  9 WHERE field_key = 'member_relationship_status';
UPDATE tg_post_field_def SET sort_order = 10 WHERE field_key = 'member_sexual_experience';
UPDATE tg_post_field_def SET sort_order = 11 WHERE field_key = 'member_profile';
UPDATE tg_post_field_def SET sort_order = 12 WHERE field_key = 'acceptance_questionnaire';
UPDATE tg_post_field_def SET sort_order = 13 WHERE field_key = 'other_sexual_interests';
UPDATE tg_post_field_def SET sort_order = 14 WHERE field_key = 'secure_pairing_options';
