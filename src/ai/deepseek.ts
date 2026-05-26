import OpenAI from 'openai';
import type { AppConfig } from '../config.js';
import { TOOL_DEFINITIONS } from '../tools/definitions.js';
import { executeTool, type ToolContext } from '../tools/handlers.js';
import { logInfo } from '../ops/runtime-log.js';

const TOOL_ROUND_NUDGE = 3;
const FORCE_REPLY_NUDGE =
  '[系統] 工具已執行完畢。請立即用普通文字回覆用戶，總結本輪結果並繼續下一題；不要再次呼叫工具。';

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
  allowedToolNames?: string[];
  maxIterations?: number;
}

async function requestFinalReply(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<string> {
  const completion = await client.chat.completions.create({
    model,
    messages: [
      ...messages,
      {
        role: 'user',
        content: '請根據以上對話及工具結果，用普通文字回覆用戶（不要用 Markdown、不要呼叫工具）。',
      },
    ],
    temperature: 0.7,
  });
  return (
    completion.choices[0]?.message?.content?.trim() ??
    '抱歉，我暫時未能處理你的請求，請稍後再試。'
  );
}

export async function runAgent(options: RunAgentOptions): Promise<string> {
  const {
    config,
    toolContext,
    systemPrompt,
    userMessage,
    history = [],
    toolsEnabled = true,
    allowedToolNames,
    maxIterations = 30,
  } = options;

  const client = createDeepSeekClient(config);
  const toolDefs =
    toolsEnabled && allowedToolNames?.length
      ? TOOL_DEFINITIONS.filter((t) => allowedToolNames.includes(t.function.name))
      : toolsEnabled
        ? TOOL_DEFINITIONS
        : undefined;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: userMessage },
  ];

  let toolRounds = 0;
  let nudgedForReply = false;

  for (let i = 0; i < maxIterations; i += 1) {
    const useTools = toolsEnabled && toolDefs && !nudgedForReply;
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: config.DEEPSEEK_MODEL,
        messages,
        tools: useTools ? toolDefs : undefined,
        tool_choice: useTools ? 'auto' : undefined,
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

    if (choice.tool_calls?.length && useTools) {
      toolRounds += 1;
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
        logInfo('ai-tool', toolCall.function.name, {
          userId: toolContext.userId,
          round: toolRounds,
          args,
          resultPreview: JSON.stringify(result).slice(0, 200),
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      const interim = choice.content?.trim() ?? '';
      const looksComplete = interim.length >= 50 || /下一題|請輸入|請選擇|？|\?/u.test(interim);
      if (interim && looksComplete) {
        return interim;
      }

      if (toolRounds >= 1 && !nudgedForReply) {
        messages.push({ role: 'user', content: FORCE_REPLY_NUDGE });
        nudgedForReply = true;
      } else if (toolRounds >= TOOL_ROUND_NUDGE && !nudgedForReply) {
        messages.push({ role: 'user', content: FORCE_REPLY_NUDGE });
        nudgedForReply = true;
      }
      continue;
    }

    const content = choice.content?.trim();
    if (content) return content;
  }

  logInfo('ai', 'Agent hit max iterations; forcing final reply', {
    userId: toolContext.userId,
    toolRounds,
  });
  return requestFinalReply(client, config.DEEPSEEK_MODEL, messages);
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
