import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { createLogger } from '@sofia/observability';

const log = createLogger('chatbot-web-error-handler');

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Payload invalido.',
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  log.error({ err }, 'Unhandled error in chatbot-web-service');
  res.status(500).json({ success: false, message: 'Error interno del servidor.' });
}
