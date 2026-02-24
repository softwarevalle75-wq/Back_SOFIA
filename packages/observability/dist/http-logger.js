"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpLoggerMiddleware = httpLoggerMiddleware;
const logger_1 = require("./logger");
function httpLoggerMiddleware(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
        logger_1.logger.info({
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            ms: Date.now() - start,
            requestId: req.requestId,
        });
    });
    next();
}
//# sourceMappingURL=http-logger.js.map