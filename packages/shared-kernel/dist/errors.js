"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceUnavailableError = exports.ValidationError = exports.ConflictError = exports.ForbiddenError = exports.UnauthorizedError = exports.NotFoundError = exports.AppError = void 0;
class AppError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
class NotFoundError extends AppError {
    constructor(resource, id) {
        super(404, 'NOT_FOUND', id ? `${resource} con id '${id}' no encontrado` : `${resource} no encontrado`);
    }
}
exports.NotFoundError = NotFoundError;
class UnauthorizedError extends AppError {
    constructor(message = 'No autorizado') {
        super(401, 'UNAUTHORIZED', message);
    }
}
exports.UnauthorizedError = UnauthorizedError;
class ForbiddenError extends AppError {
    constructor(message = 'Acceso denegado') {
        super(403, 'FORBIDDEN', message);
    }
}
exports.ForbiddenError = ForbiddenError;
class ConflictError extends AppError {
    constructor(message) {
        super(409, 'CONFLICT', message);
    }
}
exports.ConflictError = ConflictError;
class ValidationError extends AppError {
    constructor(details) {
        super(400, 'VALIDATION_ERROR', 'Error de validación', details);
    }
}
exports.ValidationError = ValidationError;
class ServiceUnavailableError extends AppError {
    constructor(service) {
        super(503, 'SERVICE_UNAVAILABLE', `Servicio '${service}' no disponible`);
    }
}
exports.ServiceUnavailableError = ServiceUnavailableError;
//# sourceMappingURL=errors.js.map