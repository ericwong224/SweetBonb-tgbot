import type { AppConfig } from '../config.js';
import { checkPostResponsesComplete, getPostFieldDefs, type PostFieldDef } from '../db/post-fields.js';
import { fieldHasChoiceOptions, getFieldOptions } from './field-choices.js';

/** Next missing required field in `tg_post_field_def.sort_order` (see getPostFieldDefs). */
export async function getNextMissingQuestionnaireField(
  config: AppConfig,
  userId: number,
): Promise<{ field: PostFieldDef; options: string[] | null } | null> {
  const defs = await getPostFieldDefs(config);
  const { missing } = await checkPostResponsesComplete(config, userId);
  const missingSet = new Set(missing);

  for (const field of defs) {
    if (!missingSet.has(field.field_key)) continue;
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
