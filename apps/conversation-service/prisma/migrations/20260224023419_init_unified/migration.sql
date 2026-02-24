-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMIN_CONSULTORIO', 'ESTUDIANTE', 'USUARIO');

-- CreateEnum
CREATE TYPE "EstadoUsuario" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "TipoIntentoLogin" AS ENUM ('LOGIN', 'CAMBIO_PASSWORD');

-- CreateEnum
CREATE TYPE "OrigenIntento" AS ENUM ('API_WEB', 'API_MOVIL');

-- CreateEnum
CREATE TYPE "Modalidad" AS ENUM ('PRESENCIAL', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "EstadoEstudiante" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('AGENDADA', 'CANCELADA', 'COMPLETIDA');

-- CreateEnum
CREATE TYPE "TipoAuditoria" AS ENUM ('CREAR', 'EDITAR', 'ELIMINAR', 'AGENDAR', 'CANCELAR', 'REPROGRAMAR', 'IMPORTAR', 'EXPORTAR', 'REPORTAR', 'LOGIN_EXITO', 'LOGIN_FALLO', 'CAMBIO_PASSWORD');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'WEBCHAT');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'WAITING_INPUT', 'HANDOFF', 'CLOSED');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'INTERACTIVE', 'SYSTEM');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "telefono" TEXT,
    "password_hash" TEXT NOT NULL,
    "primer_ingreso" BOOLEAN NOT NULL DEFAULT true,
    "rol" "Rol" NOT NULL DEFAULT 'USUARIO',
    "estado" "EstadoUsuario" NOT NULL DEFAULT 'ACTIVO',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intentos_login" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "correo" TEXT NOT NULL,
    "tipo" "TipoIntentoLogin" NOT NULL DEFAULT 'LOGIN',
    "exitoso" BOOLEAN NOT NULL DEFAULT false,
    "origen" "OrigenIntento" NOT NULL DEFAULT 'API_WEB',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "motivo_fallo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intentos_login_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ultimo_acceso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estudiantes" (
    "id" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT,
    "telefono" TEXT,
    "programa" TEXT,
    "semestre" INTEGER,
    "modalidad" "Modalidad" NOT NULL DEFAULT 'PRESENCIAL',
    "estado" "EstadoEstudiante" NOT NULL DEFAULT 'ACTIVO',
    "estadoCuenta" TEXT NOT NULL DEFAULT 'Activo',
    "accesoCitas" BOOLEAN NOT NULL DEFAULT true,
    "acudimientos" BOOLEAN NOT NULL DEFAULT false,
    "fecha_inicio" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estudiantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" TEXT NOT NULL,
    "estudiante_id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "hora" TEXT NOT NULL,
    "modalidad" "Modalidad" NOT NULL,
    "motivo" TEXT,
    "estado" "EstadoCita" NOT NULL DEFAULT 'AGENDADA',
    "usuario_nombre" TEXT,
    "usuario_tipo_documento" TEXT,
    "usuario_numero_documento" TEXT,
    "usuario_correo" TEXT,
    "usuario_telefono" TEXT,
    "enlace_reunion" TEXT,
    "conversacion_id" TEXT,
    "notif_enviada_24h" BOOLEAN NOT NULL DEFAULT false,
    "notif_enviada_15m" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "accion" "TipoAuditoria" NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "detalles" TEXT NOT NULL,
    "admin_id" TEXT,
    "admin_nombre" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_whatsapp" (
    "id" TEXT NOT NULL,
    "nombreBot" TEXT NOT NULL DEFAULT 'SOF-IA Bot',
    "phone_number_id" TEXT,
    "business_account_id" TEXT,
    "webhook_verify_token" TEXT,
    "webhook_url" TEXT,
    "token_acceso" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantillas_mensaje" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plantillas_mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversaciones" (
    "id" TEXT NOT NULL,
    "estudiante_id" TEXT,
    "tema_legal" TEXT NOT NULL,
    "consultorio" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'no_leido',
    "canal" TEXT NOT NULL DEFAULT 'whatsapp',
    "primer_mensaje" TEXT,
    "resumen" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes" (
    "id" TEXT NOT NULL,
    "conversacion_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asesoramientos" (
    "id" TEXT NOT NULL,
    "conversacion_id" TEXT NOT NULL,
    "estudiante_id" TEXT,
    "tema_legal" TEXT NOT NULL,
    "resumen" TEXT,
    "duracion_minutos" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asesoramientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encuestas_satisfaccion" (
    "id" TEXT NOT NULL,
    "conversacion_id" TEXT,
    "estudiante_id" TEXT,
    "calificacion" INTEGER NOT NULL,
    "comentario" TEXT,
    "respondida" BOOLEAN NOT NULL DEFAULT true,
    "fuente" TEXT NOT NULL DEFAULT 'whatsapp',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encuestas_satisfaccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metricas_mensuales" (
    "id" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "total_conversaciones" INTEGER NOT NULL DEFAULT 0,
    "total_asesoramientos" INTEGER NOT NULL DEFAULT 0,
    "total_citas" INTEGER NOT NULL DEFAULT 0,
    "citas_completadas" INTEGER NOT NULL DEFAULT 0,
    "citas_canceladas" INTEGER NOT NULL DEFAULT 0,
    "promedio_satisfaccion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_encuestas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "metricas_mensuales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL DEFAULT 'medium',
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "estudiante_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentFlowVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "type" "MessageType" NOT NULL,
    "text" TEXT,
    "payload" JSONB NOT NULL,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationContext" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telefono_key" ON "usuarios"("telefono");

-- CreateIndex
CREATE INDEX "intentos_login_usuario_id_creado_en_idx" ON "intentos_login"("usuario_id", "creado_en");

-- CreateIndex
CREATE INDEX "intentos_login_correo_exitoso_creado_en_idx" ON "intentos_login"("correo", "exitoso", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_token_key" ON "sesiones"("token");

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_activa_idx" ON "sesiones"("usuario_id", "activa");

-- CreateIndex
CREATE INDEX "sesiones_token_idx" ON "sesiones"("token");

-- CreateIndex
CREATE UNIQUE INDEX "estudiantes_documento_key" ON "estudiantes"("documento");

-- CreateIndex
CREATE INDEX "auditoria_entidad_creado_en_idx" ON "auditoria"("entidad", "creado_en");

-- CreateIndex
CREATE INDEX "auditoria_admin_id_creado_en_idx" ON "auditoria"("admin_id", "creado_en");

-- CreateIndex
CREATE INDEX "webhook_logs_tipo_created_at_idx" ON "webhook_logs"("tipo", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_mensaje_nombre_key" ON "plantillas_mensaje"("nombre");

-- CreateIndex
CREATE INDEX "conversaciones_estudiante_id_created_at_idx" ON "conversaciones"("estudiante_id", "created_at");

-- CreateIndex
CREATE INDEX "mensajes_conversacion_id_created_at_idx" ON "mensajes"("conversacion_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "asesoramientos_conversacion_id_key" ON "asesoramientos"("conversacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "encuestas_satisfaccion_conversacion_id_key" ON "encuestas_satisfaccion"("conversacion_id");

-- CreateIndex
CREATE INDEX "encuestas_satisfaccion_estudiante_id_created_at_idx" ON "encuestas_satisfaccion"("estudiante_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "metricas_mensuales_anio_mes_key" ON "metricas_mensuales"("anio", "mes");

-- CreateIndex
CREATE INDEX "notificaciones_leida_created_at_idx" ON "notificaciones"("leida", "created_at");

-- CreateIndex
CREATE INDEX "Contact_tenantId_channel_idx" ON "Contact"("tenantId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_channel_externalId_key" ON "Contact"("tenantId", "channel", "externalId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_contactId_status_idx" ON "Conversation"("tenantId", "contactId", "status");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_lastMessageAt_idx" ON "Conversation"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Message_tenantId_conversationId_createdAt_idx" ON "Message"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_tenantId_providerMessageId_idx" ON "Message"("tenantId", "providerMessageId");

-- CreateIndex
CREATE INDEX "ConversationContext_tenantId_conversationId_idx" ON "ConversationContext"("tenantId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationContext_tenantId_conversationId_version_key" ON "ConversationContext"("tenantId", "conversationId", "version");

-- AddForeignKey
ALTER TABLE "intentos_login" ADD CONSTRAINT "intentos_login_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_estudiante_id_fkey" FOREIGN KEY ("estudiante_id") REFERENCES "estudiantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversaciones" ADD CONSTRAINT "conversaciones_estudiante_id_fkey" FOREIGN KEY ("estudiante_id") REFERENCES "estudiantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asesoramientos" ADD CONSTRAINT "asesoramientos_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asesoramientos" ADD CONSTRAINT "asesoramientos_estudiante_id_fkey" FOREIGN KEY ("estudiante_id") REFERENCES "estudiantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encuestas_satisfaccion" ADD CONSTRAINT "encuestas_satisfaccion_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encuestas_satisfaccion" ADD CONSTRAINT "encuestas_satisfaccion_estudiante_id_fkey" FOREIGN KEY ("estudiante_id") REFERENCES "estudiantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationContext" ADD CONSTRAINT "ConversationContext_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
