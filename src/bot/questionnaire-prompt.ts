/** Tracks which questionnaire step was last sent so we don't repeat the same question. */

type PromptKind = 'choice' | 'text' | 'acceptance';

interface PromptState {
  fieldKey: string;
  kind: PromptKind;
  acceptanceIndex?: number;
}

const lastPrompt = new Map<number, PromptState>();

export function wasQuestionPrompted(userId: number, fieldKey: string): boolean {
  return lastPrompt.get(userId)?.fieldKey === fieldKey;
}

export function wasAcceptanceItemPrompted(userId: number, itemIndex: number): boolean {
  const state = lastPrompt.get(userId);
  return state?.kind === 'acceptance' && state.acceptanceIndex === itemIndex;
}

export function markQuestionPrompted(
  userId: number,
  fieldKey: string,
  kind: PromptKind,
  acceptanceIndex?: number,
): void {
  lastPrompt.set(userId, { fieldKey, kind, acceptanceIndex });
}

export function clearQuestionPrompt(userId: number, fieldKey?: string): void {
  if (!fieldKey) {
    lastPrompt.delete(userId);
    return;
  }
  if (lastPrompt.get(userId)?.fieldKey === fieldKey) {
    lastPrompt.delete(userId);
  }
}
