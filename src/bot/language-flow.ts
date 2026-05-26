import type { Api, Context } from 'grammy';
import { logInfo } from '../ops/runtime-log.js';

const languagePickerByUser = new Map<number, { chatId: number; messageId: number }>();

export function trackLanguagePicker(userId: number, chatId: number, messageId: number): void {
  languagePickerByUser.set(userId, { chatId, messageId });
}

export async function deleteLanguagePickerMessages(ctx: Context, api: Api): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const stored = languagePickerByUser.get(from.id);
  if (stored) {
    await api.deleteMessage(stored.chatId, stored.messageId).catch(() => undefined);
    languagePickerByUser.delete(from.id);
  }

  const callbackMessage = ctx.callbackQuery?.message;
  if (callbackMessage) {
    await api
      .deleteMessage(callbackMessage.chat.id, callbackMessage.message_id)
      .catch(() => undefined);
  }

  const userMessage = ctx.message;
  if (userMessage?.message_id && userMessage.chat?.id) {
    await api.deleteMessage(userMessage.chat.id, userMessage.message_id).catch(() => undefined);
  }

  logInfo('language', 'Cleared language picker messages', { userId: from.id });
}

export async function deleteMessageSafe(
  api: Api,
  chatId: number,
  messageId: number,
): Promise<void> {
  await api.deleteMessage(chatId, messageId).catch(() => undefined);
}
