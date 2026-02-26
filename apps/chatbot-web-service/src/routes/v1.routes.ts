import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { sendWebchatMessage } from '../controllers/chatbot.controller';
import { webchatRateLimit } from '../middlewares/rate-limit';

export const v1Router: ExpressRouter = Router();

v1Router.post('/chatbot/web/message', webchatRateLimit, (req, res) => {
  void sendWebchatMessage(req, res);
});
