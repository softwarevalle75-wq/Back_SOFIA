/** Formato estándar de respuesta JSON para toda la plataforma */
export interface ApiResponse<T = unknown> {
    data: T | null;
    error: {
        code: string;
        message: string;
        details?: unknown;
    } | null;
    meta?: Record<string, unknown>;
}
export declare function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T>;
export declare function paginated<T>(data: T[], total: number, page: number, limit: number): ApiResponse<T[]>;
export declare function fail(code: string, message: string, details?: unknown): ApiResponse<null>;
//# sourceMappingURL=response.d.ts.map