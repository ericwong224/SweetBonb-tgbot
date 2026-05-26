import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  DATABASE_URL: z.string().min(1),
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  BOT_MODE: z.enum(['live', 'test', 'demo', 'admin']).default('live'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  WEBHOOK_BASE_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .min(8)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use only letters, numbers, underscore, and hyphen')
    .default('sweetbonb-webhook-secret'),
  CHAT_HISTORY_LIMIT: z.coerce.number().default(20),
  AGENT_MAX_ITERATIONS: z.coerce.number().default(30),
  /** Reply "收到" only — for webhook smoke test */
  TEST_MESSAGE_ACK: z.coerce.boolean().default(false),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}
