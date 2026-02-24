"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestIdMiddleware = requestIdMiddleware;
const uuid_1 = require("uuid");
/**
 * Middleware: asigna / propaga X-Request-Id en cada request.
 */
function requestIdMiddleware(req, res, next) {
    const id = req.headers['x-request-id'] || (0, uuid_1.v4)();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
}
//# sourceMappingURL=request-id.js.map