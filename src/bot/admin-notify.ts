import type { Api } from 'grammy';
import { logInfo, logWarn } from '../ops/runtime-log.js';

const lastAlertAt = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 5 * 60_000;

export function formatAdminErrorAlert(context: {
  category: string;
  error: string;
  bot?: string;
  mode?: string;
  userId?: number;
  username?: string | null;
  stage?: string;
  userMessage?: string;
}): string {
  const lines = [
    '⚠️ SweetBonb Bot Error',
    `類別: ${context.category}`,
    `Bot: @${context.bot ?? '?'} (${context.mode ?? '?'})`,
  ];
  if (context.userId != null) {
    lines.push(`用戶: ${context.userId}${context.username ? ` (@${context.username})` : ''}`);
  }
  if (context.stage) lines.push(`Stage: ${context.stage}`);
  if (context.userMessage) {
    lines.push(`用戶訊息: ${context.userMessage.slice(0, 120)}`);
  }
  lines.push(`Error: ${context.error.slice(0, 500)}`);
  lines.push(`時間: ${new Date().toISOString()}`);
  return lines.join('\n');
}

export async function notifyAdmin(api: Api, adminId: number, text: string): Promise<void> {
  if (!adminId) return;
  try {
    await api.sendMessage(adminId, text);
    logInfo('admin', 'Error alert sent', { adminId });
  } catch (error) {
    logWarn('admin', 'Failed to send admin alert', {
      adminId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function notifyAdminThrottled(
  api: Api,
  adminId: number,
  dedupeKey: string,
  text: string,
  cooldownMs = DEFAULT_COOLDOWN_MS,
): Promise<void> {
  const now = Date.now();
  const last = lastAlertAt.get(dedupeKey) ?? 0;
  if (now - last < cooldownMs) return;
  lastAlertAt.set(dedupeKey, now);
  await notifyAdmin(api, adminId, text);
}
