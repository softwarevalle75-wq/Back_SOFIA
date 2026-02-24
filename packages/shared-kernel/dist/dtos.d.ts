import { z } from 'zod';
import { Rol, EstadoCita, EstadoCaso, AreaDerecho } from './enums';
export declare const RegisterDto: z.ZodObject<{
    nombreCompleto: z.ZodString;
    correo: z.ZodString;
    telefono: z.ZodOptional<z.ZodString>;
    password: z.ZodString;
    rol: z.ZodDefault<z.ZodNativeEnum<typeof Rol>>;
}, "strip", z.ZodTypeAny, {
    nombreCompleto: string;
    correo: string;
    password: string;
    rol: Rol;
    telefono?: string | undefined;
}, {
    nombreCompleto: string;
    correo: string;
    password: string;
    telefono?: string | undefined;
    rol?: Rol | undefined;
}>;
export type RegisterDto = z.infer<typeof RegisterDto>;
export declare const LoginDto: z.ZodObject<{
    correo: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    correo: string;
    password: string;
}, {
    correo: string;
    password: string;
}>;
export type LoginDto = z.infer<typeof LoginDto>;
export interface JwtPayload {
    sub: string;
    correo: string;
    rol: Rol;
    iat?: number;
    exp?: number;
}
export declare const CreateEstudianteDto: z.ZodObject<{
    usuarioId: z.ZodString;
    codigo: z.ZodOptional<z.ZodString>;
    programa: z.ZodString;
    semestre: z.ZodOptional<z.ZodNumber>;
    activoConsultorio: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    usuarioId: string;
    programa: string;
    activoConsultorio: boolean;
    codigo?: string | undefined;
    semestre?: number | undefined;
}, {
    usuarioId: string;
    programa: string;
    codigo?: string | undefined;
    semestre?: number | undefined;
    activoConsultorio?: boolean | undefined;
}>;
export type CreateEstudianteDto = z.infer<typeof CreateEstudianteDto>;
export declare const UpdateEstudianteDto: z.ZodObject<{
    codigo: z.ZodOptional<z.ZodString>;
    programa: z.ZodOptional<z.ZodString>;
    semestre: z.ZodOptional<z.ZodNumber>;
    activoConsultorio: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    codigo?: string | undefined;
    programa?: string | undefined;
    semestre?: number | undefined;
    activoConsultorio?: boolean | undefined;
}, {
    codigo?: string | undefined;
    programa?: string | undefined;
    semestre?: number | undefined;
    activoConsultorio?: boolean | undefined;
}>;
export type UpdateEstudianteDto = z.infer<typeof UpdateEstudianteDto>;
export declare const CreateCitaDto: z.ZodObject<{
    casoId: z.ZodString;
    fechaHora: z.ZodString;
    notas: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    casoId: string;
    fechaHora: string;
    notas?: string | undefined;
}, {
    casoId: string;
    fechaHora: string;
    notas?: string | undefined;
}>;
export type CreateCitaDto = z.infer<typeof CreateCitaDto>;
export declare const UpdateEstadoCitaDto: z.ZodObject<{
    estado: z.ZodNativeEnum<typeof EstadoCita>;
    notas: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    estado: EstadoCita;
    notas?: string | undefined;
}, {
    estado: EstadoCita;
    notas?: string | undefined;
}>;
export type UpdateEstadoCitaDto = z.infer<typeof UpdateEstadoCitaDto>;
export declare const CreateCasoDto: z.ZodObject<{
    telefonoContacto: z.ZodOptional<z.ZodString>;
    areaDerecho: z.ZodOptional<z.ZodNativeEnum<typeof AreaDerecho>>;
    descripcion: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    telefonoContacto?: string | undefined;
    areaDerecho?: AreaDerecho | undefined;
    descripcion?: string | undefined;
}, {
    telefonoContacto?: string | undefined;
    areaDerecho?: AreaDerecho | undefined;
    descripcion?: string | undefined;
}>;
export type CreateCasoDto = z.infer<typeof CreateCasoDto>;
export declare const UpdateCasoDto: z.ZodObject<{
    telefonoContacto: z.ZodOptional<z.ZodString>;
    areaDerecho: z.ZodOptional<z.ZodNativeEnum<typeof AreaDerecho>>;
    descripcion: z.ZodOptional<z.ZodString>;
    esCompetencia: z.ZodOptional<z.ZodBoolean>;
    razonCompetencia: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    telefonoContacto?: string | undefined;
    areaDerecho?: AreaDerecho | undefined;
    descripcion?: string | undefined;
    esCompetencia?: boolean | undefined;
    razonCompetencia?: string | undefined;
}, {
    telefonoContacto?: string | undefined;
    areaDerecho?: AreaDerecho | undefined;
    descripcion?: string | undefined;
    esCompetencia?: boolean | undefined;
    razonCompetencia?: string | undefined;
}>;
export type UpdateCasoDto = z.infer<typeof UpdateCasoDto>;
export declare const UpdateEstadoCasoDto: z.ZodObject<{
    estado: z.ZodNativeEnum<typeof EstadoCaso>;
}, "strip", z.ZodTypeAny, {
    estado: EstadoCaso;
}, {
    estado: EstadoCaso;
}>;
export type UpdateEstadoCasoDto = z.infer<typeof UpdateEstadoCasoDto>;
export declare const TelegramWebhookDto: z.ZodObject<{
    telefono: z.ZodString;
    mensaje: z.ZodString;
    nombreContacto: z.ZodOptional<z.ZodString>;
    messageId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    telefono: string;
    mensaje: string;
    nombreContacto?: string | undefined;
    messageId?: string | undefined;
    timestamp?: string | undefined;
}, {
    telefono: string;
    mensaje: string;
    nombreContacto?: string | undefined;
    messageId?: string | undefined;
    timestamp?: string | undefined;
}>;
export type TelegramWebhookDto = z.infer<typeof TelegramWebhookDto>;
export declare const WhatsAppWebhookDto: z.ZodObject<{
    telefono: z.ZodString;
    mensaje: z.ZodString;
    nombreContacto: z.ZodOptional<z.ZodString>;
    messageId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    telefono: string;
    mensaje: string;
    nombreContacto?: string | undefined;
    messageId?: string | undefined;
    timestamp?: string | undefined;
}, {
    telefono: string;
    mensaje: string;
    nombreContacto?: string | undefined;
    messageId?: string | undefined;
    timestamp?: string | undefined;
}>;
export type WhatsAppWebhookDto = TelegramWebhookDto;
export declare const IaRespondDto: z.ZodObject<{
    telefono: z.ZodString;
    sesionId: z.ZodString;
    textoUsuario: z.ZodString;
    contexto: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    telefono: string;
    sesionId: string;
    textoUsuario: string;
    contexto?: Record<string, unknown> | undefined;
}, {
    telefono: string;
    sesionId: string;
    textoUsuario: string;
    contexto?: Record<string, unknown> | undefined;
}>;
export type IaRespondDto = z.infer<typeof IaRespondDto>;
export declare const CreateConsentimientoDto: z.ZodObject<{
    telefono: z.ZodOptional<z.ZodString>;
    versionPolitica: z.ZodString;
    ip: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    versionPolitica: string;
    telefono?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
}, {
    versionPolitica: string;
    telefono?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
}>;
export type CreateConsentimientoDto = z.infer<typeof CreateConsentimientoDto>;
export declare const PaginationDto: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
}, {
    page?: number | undefined;
    limit?: number | undefined;
}>;
export type PaginationDto = z.infer<typeof PaginationDto>;
//# sourceMappingURL=dtos.d.ts.map