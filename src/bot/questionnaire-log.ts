import type { AppConfig } from '../config.js';
import { logMessage } from '../db/messages.js';

export interface QuestionnaireLogContext {
  config: AppConfig;
  botHandle: string;
  userId: number;
  stageKey?: string | null;
}

export async function logQuestionnaireUserAnswer(
  log: QuestionnaireLogContext,
  content: string,
): Promise<void> {
  await logMessage(log.config, {
    userId: log.userId,
    botHandle: log.botHandle,
    msgType: 'incoming-msg',
    msgContent: content,
    stageKey: log.stageKey ?? 'profile_complete',
    agentKey: 'sb-main',
  });
}

export async function logQuestionnaireBotPrompt(
  log: QuestionnaireLogContext,
  content: string,
): Promise<void> {
  await logMessage(log.config, {
    userId: log.userId,
    botHandle: log.botHandle,
    msgType: 'send-ai-reply',
    msgContent: content,
    stageKey: log.stageKey ?? 'profile_complete',
    agentKey: 'sb-main',
  });
}
