import type { AppConfig } from '../config.js';
import { checkPostResponsesComplete, getPostFieldDefs, type PostFieldDef } from '../db/post-fields.js';
import { fieldHasChoiceOptions, getFieldOptions } from './field-choices.js';

/** Business order — matches legacy N8N / AI prompt flow. */
export const QUESTIONNAIRE_FIELD_ORDER = [
  'target_gender',
  'target_relationship',
  'target_age',
  'target_height',
  'target_relationship_status',
  'target_bodyshape',
  'member_height',
  'member_weight',
  'member_relationship_status',
  'member_sexual_experience',
  'member_profile',
  'acceptance_questionnaire',
  'other_sexual_interests',
  'secure_pairing_options',
] as const;

export async function getNextMissingQuestionnaireField(
  config: AppConfig,
  userId: number,
): Promise<{ field: PostFieldDef; options: string[] | null } | null> {
  const defs = await getPostFieldDefs(config);
  const defMap = new Map(defs.map((d) => [d.field_key, d]));
  const { missing } = await checkPostResponsesComplete(config, userId);

  for (const key of QUESTIONNAIRE_FIELD_ORDER) {
    if (!missing.includes(key)) continue;
    const field = defMap.get(key);
    if (!field) continue;
    const options = fieldHasChoiceOptions(field) ? getFieldOptions(field) : null;
    return { field, options };
  }
  return null;
}

export async function getNextMissingChoiceFieldOrdered(
  config: AppConfig,
  userId: number,
): Promise<{ field: PostFieldDef; options: string[] } | null> {
  const next = await getNextMissingQuestionnaireField(config, userId);
  if (!next?.options?.length) return null;
  return { field: next.field, options: next.options };
}
