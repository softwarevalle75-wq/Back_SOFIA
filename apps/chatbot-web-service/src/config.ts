import { validateEnv } from '@sofia/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3060),
  ORCHESTRATOR_SERVICE_URL: z.string().url().default('http://localhost:3021'),
  WEBCHAT_TENANT_ID: z.string().min(1).default('tenant_ai_demo'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(25),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
});

export const env = validateEnv(EnvSchema);
