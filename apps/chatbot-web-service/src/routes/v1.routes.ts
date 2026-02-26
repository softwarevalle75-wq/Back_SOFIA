import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { sendWebchatMessage } from '../controllers/chatbot.controller';

export const v1Router: ExpressRouter = Router();

v1Router.post('/chatbot/web/message', (req, res) => {
  void sendWebchatMessage(req, res);
});
