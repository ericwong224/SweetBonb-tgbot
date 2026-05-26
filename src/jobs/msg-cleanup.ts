import type { Api } from 'grammy';
import type { AppConfig } from '../config.js';
import { markMessageDelWhole, pickNextDeletableMessage } from '../db/chat-log.js';
import { deactivateProfile } from '../db/profile.js';
import { resetUserPostDraft } from '../db/user-post.js';
import { resolveUserStage } from '../flow/stages.js';

export function startMsgCleanupJob(options: {
  config: AppConfig;
  api: Api;
  botHandle: string;
}): void {
  const { config, api, botHandle } = options;
  if (!config.MSG_CLEANUP_ENABLED) {
    console.log('MSG cleanup job disabled');
    return;
  }

  const tick = async () => {
    try {
      await runMsgCleanupTick(config, api, botHandle);
    } catch (error) {
      console.error('MSG cleanup tick error:', error);
    }
  };

  const handle = setInterval(tick, config.MSG_CLEANUP_INTERVAL_MS);
  if (typeof handle.unref === 'function') handle.unref();
  console.log(`MSG cleanup job started (every ${config.MSG_CLEANUP_INTERVAL_MS}ms)`);
}

async function runMsgCleanupTick(
  config: AppConfig,
  api: Api,
  botHandle: string,
): Promise<void> {
  const row = await pickNextDeletableMessage(
    config,
    botHandle,
    config.MSG_CLEANUP_INACTIVE_HOURS,
    config.MSG_CLEANUP_MAX_AGE_HOURS,
  );
  if (!row?.chat_id || !row.message_id) return;

  try {
    await api.deleteMessage(row.chat_id, row.message_id);
    await markMessageDelWhole(config, row.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('chat not found')) {
      await deactivateProfile(config, row.user_id);
      await resetUserPostDraft(config, row.user_id);
      await resolveUserStage(config, row.user_id);
    }
    await markMessageDelWhole(config, row.id, message);
  }
}
