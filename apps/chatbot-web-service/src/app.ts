import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import { httpLoggerMiddleware, requestIdMiddleware } from '@sofia/observability';
import { env } from './config';
import { v1Router } from './routes/v1.routes';
import { errorHandler } from './middlewares/error-handler';

function buildCorsOrigin(): true | string[] {
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN === '*') return true;
  return env.CORS_ORIGIN.split(',').map((item) => item.trim()).filter(Boolean);
}

export const app: Express = express();

app.use(cors({ origin: buildCorsOrigin() }));
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'chatbot-web-service', timestamp: new Date().toISOString() });
});

app.use('/v1', v1Router);
app.use(errorHandler);
