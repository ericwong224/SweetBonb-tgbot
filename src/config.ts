import { z } from 'zod';

/** DO/App Platform env vars are strings — z.coerce.boolean() treats "false" as true. */
function envBool(defaultValue: boolean) {
  return z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return defaultValue;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    return defaultValue;
  }, z.boolean());
}

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
  TEST_MESSAGE_ACK: envBool(false),
  MSG_CLEANUP_ENABLED: envBool(true),
  MSG_CLEANUP_INTERVAL_MS: z.coerce.number().default(60_000),
  MSG_CLEANUP_INACTIVE_HOURS: z.coerce.number().default(24),
  MSG_CLEANUP_MAX_AGE_HOURS: z.coerce.number().default(36),
  OPS_LOG_ENABLED: envBool(true),
  OPS_LOG_TOKEN: z.string().min(8).optional(),
  OPS_LOG_MAX_ENTRIES: z.coerce.number().default(500),
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
