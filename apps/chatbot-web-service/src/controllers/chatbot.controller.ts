import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createLogger } from '@sofia/observability';
import { env } from '../config';

const log = createLogger('chatbot-web-controller');

const MessageInputSchema = z.object({
  message: z.string().trim().min(1, 'El mensaje es obligatorio.'),
  externalUserId: z.string().trim().optional(),
  displayName: z.string().trim().optional(),
  tenantId: z.string().trim().optional(),
});

type OrchestratorResponseItem = {
  type?: string;
  text?: string;
  payload?: Record<string, unknown>;
};

type OrchestratorEnvelope = {
  success?: boolean;
  data?: {
    responses?: OrchestratorResponseItem[];
    conversationId?: string;
    correlationId?: string;
  };
  message?: string;
};

function normalizeExternalUserId(req: Request, provided?: string): string {
  if (provided && provided.trim().length > 0) return provided.trim();

  const authUser = (req as Request & { user?: { userId?: string; email?: string } }).user;
  if (authUser?.userId) return authUser.userId;
  if (authUser?.email) return authUser.email;

  return `web-${req.ip || req.socket.remoteAddress || randomUUID()}`;
}

export async function sendWebchatMessage(req: Request, res: Response): Promise<void> {
  const parsed = MessageInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: parsed.error.flatten().formErrors[0] || 'Payload invalido.',
    });
    return;
  }

  const correlationId = (req.headers['x-correlation-id'] as string) || `webchat-${Date.now()}-${randomUUID()}`;
  const externalUserId = normalizeExternalUserId(req, parsed.data.externalUserId);
  const tenantId = parsed.data.tenantId || env.WEBCHAT_TENANT_ID;

  const orchestratorPayload = {
    tenantId,
    channel: 'webchat' as const,
    externalUserId,
    ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
    message: {
      type: 'text' as const,
      text: parsed.data.message,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.REQUEST_TIMEOUT_MS);

  try {
    const baseUrl = env.ORCHESTRATOR_SERVICE_URL.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/v1/orchestrator/handle-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-correlation-id': correlationId,
        'x-request-id': correlationId,
      },
      body: JSON.stringify(orchestratorPayload),
      signal: controller.signal,
    });

    const payload = (await response.json()) as OrchestratorEnvelope;
    if (!response.ok || payload.success === false) {
      const message = payload.message || 'No fue posible procesar el mensaje en el orquestador.';
      res.status(502).json({ success: false, message });
      return;
    }

    const responses = Array.isArray(payload.data?.responses) ? payload.data.responses : [];
    const botMessages = responses
      .map((item) => (typeof item?.text === 'string' ? item.text.trim() : ''))
      .filter((text) => text.length > 0);

    res.status(200).json({
      success: true,
      data: {
        externalUserId,
        conversationId: payload.data?.conversationId || null,
        correlationId: payload.data?.correlationId || correlationId,
        responses,
        botMessages,
      },
    });
  } catch (error) {
    log.error(
      {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Error forwarding webchat message to orchestrator',
    );

    res.status(500).json({
      success: false,
      message: 'Error al enviar mensaje al chatbot web.',
    });
  } finally {
    clearTimeout(timer);
  }
}
