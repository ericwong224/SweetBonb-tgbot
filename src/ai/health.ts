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

export function isDeepSeekAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('401') || message.toLowerCase().includes('authentication');
}

export function userFacingAiError(error: unknown, lang: string | null | undefined): string {
  if (isDeepSeekAuthError(error)) {
    if (lang === 'en') {
      return 'AI service is temporarily unavailable (API configuration). Please contact support.';
    }
    if (lang === 'zh-written') {
      return 'AI 服務暫時未能使用（API 設定問題），請稍後再試或聯絡管理員。';
    }
    return 'AI 暫時用唔到（API 設定問題），請稍後再試或聯絡管理員。';
  }

  if (lang === 'en') return 'Sorry, AI is temporarily unavailable. Please try again later.';
  if (lang === 'zh-written') return '抱歉，AI 暫時未能回應，請稍後再試。';
  return '抱歉，AI 暫時未能回應，請稍後再試。';
}
