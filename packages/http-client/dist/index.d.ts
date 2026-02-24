/**
 * Cliente HTTP ligero para comunicación inter-servicio.
 * Usa fetch nativo de Node 20+ (sin dependencias externas).
 */
export interface ServiceRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    timeout?: number;
}
export declare function serviceRequest<T = unknown>(baseUrl: string, path: string, options?: ServiceRequestOptions): Promise<T>;
//# sourceMappingURL=index.d.ts.map