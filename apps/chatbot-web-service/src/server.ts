import { createLogger } from '@sofia/observability';
import { envDebug } from '@sofia/config';
import { app } from './app';
import { env } from './config';

envDebug('chatbot-web-service');

const log = createLogger('chatbot-web-service');

app.listen(env.PORT, () => {
  log.info(`chatbot-web-service escuchando en http://localhost:${env.PORT}`);
});
