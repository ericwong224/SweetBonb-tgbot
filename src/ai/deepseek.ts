import OpenAI from 'openai';
import type { AppConfig } from '../config.js';
import { TOOL_DEFINITIONS } from '../tools/definitions.js';
import { executeTool, type ToolContext } from '../tools/handlers.js';

export function createDeepSeekClient(config: AppConfig): OpenAI {
  return new OpenAI({
    apiKey: config.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com',
  });
}

export interface RunAgentOptions {
  config: AppConfig;
  toolContext: ToolContext;
  systemPrompt: string;
  userMessage: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  toolsEnabled?: boolean;
  maxIterations?: number;
}

export async function runAgent(options: RunAgentOptions): Promise<string> {
  const {
    config,
    toolContext,
    systemPrompt,
    userMessage,
    history = [],
    toolsEnabled = true,
    maxIterations = 30,
  } = options;

  const client = createDeepSeekClient(config);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: userMessage },
  ];

  for (let i = 0; i < maxIterations; i += 1) {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: config.DEEPSEEK_MODEL,
        messages,
        tools: toolsEnabled ? TOOL_DEFINITIONS : undefined,
        tool_choice: toolsEnabled ? 'auto' : undefined,
        temperature: 0.7,
      });
    } catch (error) {
      console.error('DeepSeek API error:', error);
      throw error;
    }

    const choice = completion.choices[0]?.message;
    if (!choice) {
      throw new Error('DeepSeek returned empty response');
    }

    if (choice.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: choice.content ?? '',
        tool_calls: choice.tool_calls,
      });

      for (const toolCall of choice.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await executeTool(toolContext, toolCall.function.name, args);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    const content = choice.content?.trim();
    if (content) return content;
  }

  return '抱歉，我暫時未能處理你的請求，請稍後再試。';
}

export async function runMatchAnalysis(
  config: AppConfig,
  systemPrompt: string,
  initiatorData: string,
  targetData: string,
): Promise<string> {
  const client = createDeepSeekClient(config);
  const completion = await client.chat.completions.create({
    model: config.DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `請分析以下配對資料：\n\n【發起方資料】\n${initiatorData}\n\n【目標方資料】\n${targetData}`,
      },
    ],
    temperature: 0.2,
  });

  return completion.choices[0]?.message?.content?.trim() ?? '不匹配';
}
