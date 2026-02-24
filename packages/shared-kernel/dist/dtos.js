"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaginationDto = exports.CreateConsentimientoDto = exports.IaRespondDto = exports.WhatsAppWebhookDto = exports.TelegramWebhookDto = exports.UpdateEstadoCasoDto = exports.UpdateCasoDto = exports.CreateCasoDto = exports.UpdateEstadoCitaDto = exports.CreateCitaDto = exports.UpdateEstudianteDto = exports.CreateEstudianteDto = exports.LoginDto = exports.RegisterDto = void 0;
const zod_1 = require("zod");
const enums_1 = require("./enums");
// ─── Auth ──────────────────────────────────────────
exports.RegisterDto = zod_1.z.object({
    nombreCompleto: zod_1.z.string().min(2).max(200),
    correo: zod_1.z.string().email(),
    telefono: zod_1.z.string().min(7).max(20).optional(),
    password: zod_1.z.string().min(8).max(128),
    rol: zod_1.z.nativeEnum(enums_1.Rol).default(enums_1.Rol.USUARIO),
});
exports.LoginDto = zod_1.z.object({
    correo: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
// ─── Estudiante ────────────────────────────────────
exports.CreateEstudianteDto = zod_1.z.object({
    usuarioId: zod_1.z.string().uuid(),
    codigo: zod_1.z.string().optional(),
    programa: zod_1.z.string().min(2),
    semestre: zod_1.z.number().int().min(1).max(20).optional(),
    activoConsultorio: zod_1.z.boolean().default(false),
});
exports.UpdateEstudianteDto = zod_1.z.object({
    codigo: zod_1.z.string().optional(),
    programa: zod_1.z.string().min(2).optional(),
    semestre: zod_1.z.number().int().min(1).max(20).optional(),
    activoConsultorio: zod_1.z.boolean().optional(),
});
// ─── Cita ──────────────────────────────────────────
exports.CreateCitaDto = zod_1.z.object({
    casoId: zod_1.z.string().uuid(),
    fechaHora: zod_1.z.string().datetime(),
    notas: zod_1.z.string().optional(),
});
exports.UpdateEstadoCitaDto = zod_1.z.object({
    estado: zod_1.z.nativeEnum(enums_1.EstadoCita),
    notas: zod_1.z.string().optional(),
});
// ─── Caso ──────────────────────────────────────────
exports.CreateCasoDto = zod_1.z.object({
    telefonoContacto: zod_1.z.string().optional(),
    areaDerecho: zod_1.z.nativeEnum(enums_1.AreaDerecho).optional(),
    descripcion: zod_1.z.string().optional(),
});
exports.UpdateCasoDto = zod_1.z.object({
    telefonoContacto: zod_1.z.string().optional(),
    areaDerecho: zod_1.z.nativeEnum(enums_1.AreaDerecho).optional(),
    descripcion: zod_1.z.string().optional(),
    esCompetencia: zod_1.z.boolean().optional(),
    razonCompetencia: zod_1.z.string().optional(),
});
exports.UpdateEstadoCasoDto = zod_1.z.object({
    estado: zod_1.z.nativeEnum(enums_1.EstadoCaso),
});
// ─── Telegram webhook ──────────────────────────────
exports.TelegramWebhookDto = zod_1.z.object({
    telefono: zod_1.z.string().min(7),
    mensaje: zod_1.z.string().min(1),
    nombreContacto: zod_1.z.string().optional(),
    messageId: zod_1.z.string().optional(),
    timestamp: zod_1.z.string().optional(),
});
// Backward compatibility
exports.WhatsAppWebhookDto = exports.TelegramWebhookDto;
// ─── IA ────────────────────────────────────────────
exports.IaRespondDto = zod_1.z.object({
    telefono: zod_1.z.string(),
    sesionId: zod_1.z.string().uuid(),
    textoUsuario: zod_1.z.string(),
    contexto: zod_1.z.record(zod_1.z.unknown()).optional(),
});
// ─── Consentimiento ────────────────────────────────
exports.CreateConsentimientoDto = zod_1.z.object({
    telefono: zod_1.z.string().min(7).optional(),
    versionPolitica: zod_1.z.string().min(1),
    ip: zod_1.z.string().optional(),
    userAgent: zod_1.z.string().optional(),
});
// ─── Paginación ────────────────────────────────────
exports.PaginationDto = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
//# sourceMappingURL=dtos.js.map