import { Request, Response, NextFunction } from 'express';
declare global {
    namespace Express {
        interface Request {
            requestId?: string;
        }
    }
}
/**
 * Middleware: asigna / propaga X-Request-Id en cada request.
 */
export declare function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=request-id.d.ts.map