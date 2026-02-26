# chatbot-web-service

Microservicio HTTP para chatbot web.

Este servicio recibe mensajes del frontend web y los reenvia al `orchestrator-service` de `Back_SOFIA` con `channel: "webchat"`.

## Endpoints

- `GET /health`
- `POST /v1/chatbot/web/message`

Payload esperado:

```json
{
  "message": "hola",
  "externalUserId": "web-user-123",
  "displayName": "Usuario Web",
  "tenantId": "tenant_ai_demo"
}
```

## Variables de entorno

```env
PORT=3060
ORCHESTRATOR_SERVICE_URL=http://localhost:3021
WEBCHAT_TENANT_ID=tenant_ai_demo
REQUEST_TIMEOUT_MS=30000
CORS_ORIGIN=*
```

## Desarrollo local

```bash
pnpm --filter chatbot-web-service dev
```

## Build

```bash
pnpm --filter chatbot-web-service build
pnpm --filter chatbot-web-service start
```

## Docker / Railway

Dockerfile incluido en `apps/chatbot-web-service/Dockerfile`.

Build image:

```bash
docker build -f apps/chatbot-web-service/Dockerfile -t chatbot-web-service .
```

Run:

```bash
docker run --rm -p 3060:3060 \
  -e PORT=3060 \
  -e ORCHESTRATOR_SERVICE_URL=http://host.docker.internal:3021 \
  -e WEBCHAT_TENANT_ID=tenant_ai_demo \
  chatbot-web-service
```

En Railway:

- Root directory: `Back_SOFIA`
- Dockerfile path: `apps/chatbot-web-service/Dockerfile`
- Variables: `PORT`, `ORCHESTRATOR_SERVICE_URL`, `WEBCHAT_TENANT_ID`, `REQUEST_TIMEOUT_MS`, `CORS_ORIGIN`

## Checklist rapido Railway

1. Crear un servicio nuevo en Railway conectado al repo.
2. Configurar **Root Directory** como `Back_SOFIA`.
3. Dejar que Railway use `Back_SOFIA/railway.json` (ya apunta al Dockerfile correcto).
4. Cargar variables de entorno:

```env
PORT=3060
ORCHESTRATOR_SERVICE_URL=https://<tu-orchestrator>/
WEBCHAT_TENANT_ID=tenant_ai_demo
REQUEST_TIMEOUT_MS=30000
CORS_ORIGIN=https://<tu-frontend>
```

5. Deploy y verificar `GET /health`.
6. Probar bridge con:

```bash
curl -X POST "https://<tu-chatbot-web>/v1/chatbot/web/message" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hola","externalUserId":"railway-test-1","tenantId":"tenant_ai_demo"}'
```
