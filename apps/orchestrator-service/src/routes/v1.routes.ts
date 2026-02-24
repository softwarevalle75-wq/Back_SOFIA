import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { MessageInSchema } from '../dtos';
import { orchestratorController } from '../controllers/orchestrator.controller';
import { validate } from '../middlewares/validate';

export const v1Router: ExpressRouter = Router();

v1Router.post(
  '/orchestrator/handle-message',
  validate({ body: MessageInSchema }),
  orchestratorController.handleMessage,
);
