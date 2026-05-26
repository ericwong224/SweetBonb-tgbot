import OpenAI from 'openai';
import type { AppConfig } from '../config.js';

export async function verifyDeepSeekApi(config: AppConfig): Promise<{ ok: boolean; error?: string }> {
  const client = new OpenAI({
    apiKey: config.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com',
  });

  try {
    await client.chat.completions.create({
      model: config.DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

/** Generic user-facing message — no internal error details. */
export function userFacingAiError(lang: string | null | undefined): string {
  if (lang === 'en') {
    return 'Sorry, temporarily unable to respond. Please try again later.';
  }
  return '抱歉，暫時未能回應，請稍後再試。';
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
