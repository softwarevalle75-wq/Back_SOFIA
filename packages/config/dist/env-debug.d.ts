/**
 * Imprime una sola vez un resumen de variables de entorno críticas.
 *
 * Se activa solo si `ENV_DEBUG=true` (o `1`, `yes`).
 * No imprime secretos completos. Seguro para logs de desarrollo.
 *
 * @param serviceName  Nombre del microservicio que invoca (e.g. "ms-casos").
 */
export declare function envDebug(serviceName: string): void;
//# sourceMappingURL=env-debug.d.ts.map