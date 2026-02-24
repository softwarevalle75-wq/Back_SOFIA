"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
const pino_1 = __importDefault(require("pino"));
function createLogger(name) {
    return (0, pino_1.default)({
        name,
        level: process.env.LOG_LEVEL || 'info',
        transport: process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
            : undefined,
    });
}
exports.logger = createLogger('sofia');
//# sourceMappingURL=logger.js.map