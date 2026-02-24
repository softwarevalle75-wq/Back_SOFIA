import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import { requestIdMiddleware, httpLoggerMiddleware } from '@sofia/observability';
import { v1Router } from './routes/v1.routes';
import { errorHandler } from './middlewares/error-handler';

export const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);
app.use(httpLoggerMiddleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'conversation-service', timestamp: new Date().toISOString() });
});

app.use('/v1', v1Router);
app.use(errorHandler);
