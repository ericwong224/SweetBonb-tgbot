import type { AppConfig } from '../config.js';
import { upsertUserFlow, type UserStage } from '../db/flow-state.js';
import { checkPostResponsesComplete } from '../db/post-fields.js';
import { getProfile, isCoreProfileComplete } from '../db/profile.js';
import { getUserPost, isPostPublished } from '../db/user-post.js';

export type { UserStage };

export async function resolveUserStage(
  config: AppConfig,
  userId: number,
): Promise<UserStage> {
  const profile = await getProfile(config, userId);

  if (!isCoreProfileComplete(profile)) {
    await upsertUserFlow(config, userId, 'profile_incomplete');
    return 'profile_incomplete';
  }

  const postCheck = await checkPostResponsesComplete(config, userId);
  if (!postCheck.complete) {
    await upsertUserFlow(config, userId, 'profile_complete');
    return 'profile_complete';
  }

  const userPost = await getUserPost(config, userId);
  if (!isPostPublished(userPost)) {
    await upsertUserFlow(config, userId, 'post_ready');
    return 'post_ready';
  }

  await upsertUserFlow(config, userId, 'post_published');
  return 'post_published';
}

export function toolsForStage(stage: UserStage): string[] {
  const base = ['member_info', 'edit_g_info'];
  switch (stage) {
    case 'profile_incomplete':
      return base;
    case 'profile_complete':
      return [...base, 'get_post_data', 'save_post_data', 'check_post_data', 'channel_info', 'check_member'];
    case 'post_ready':
      return [
        ...base,
        'get_post_data',
        'save_post_data',
        'check_post_data',
        'channel_info',
        'check_member',
        'post2publish',
        'post2draft',
      ];
    case 'post_published':
      return [
        ...base,
        'get_post_data',
        'save_post_data',
        'check_post_data',
        'channel_info',
        'check_member',
        'post2publish',
        'post2draft',
        'match_request',
        'match_reply',
      ];
  }
}
