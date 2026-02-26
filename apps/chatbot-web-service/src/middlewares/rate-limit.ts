import type { NextFunction, Request, Response } from 'express';
import { env } from '../config';

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function resolveKey(req: Request): string {
  const body = req.body as { externalUserId?: unknown };
  const externalUserId = typeof body?.externalUserId === 'string' ? body.externalUserId.trim() : '';
  if (externalUserId) return `user:${externalUserId}`;
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

export function webchatRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = resolveKey(req);
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + env.RATE_LIMIT_WINDOW_MS,
    });
    next();
    return;
  }

  if (current.count >= env.RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      success: false,
      message: 'Demasiadas solicitudes. Intenta nuevamente en unos segundos.',
    });
    return;
  }

  current.count += 1;
  buckets.set(key, current);
  next();
}
