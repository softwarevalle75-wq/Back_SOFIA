"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.envDebug = exports.BaseEnvSchema = void 0;
exports.validateEnv = validateEnv;
const dotenv_1 = require("dotenv");
const zod_1 = require("zod");
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
// Busca .env subiendo desde cwd hasta encontrar la raíz del monorepo
function findMonorepoRoot(startDir) {
    let dir = startDir;
    while (dir !== path_1.default.dirname(dir)) {
        if ((0, fs_1.existsSync)(path_1.default.join(dir, 'pnpm-workspace.yaml')))
            return dir;
        dir = path_1.default.dirname(dir);
    }
    return startDir;
}
const monorepoRoot = findMonorepoRoot(process.cwd());
// 1. Carga .env local del servicio (mayor prioridad)
(0, dotenv_1.config)();
// 2. Carga .env desde la raíz del monorepo (valores por defecto)
(0, dotenv_1.config)({ path: path_1.default.resolve(monorepoRoot, '.env') });
/**
 * Valida variables de entorno contra un schema Zod.
 * Lanza error legible si falta algo.
 */
function validateEnv(schema) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
        const formatted = result.error.issues
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n');
        throw new Error(`❌ Variables de entorno inválidas:\n${formatted}`);
    }
    return result.data;
}
/** Schema base compartido por todos los MS */
exports.BaseEnvSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: zod_1.z.string().url(),
    JWT_SECRET: zod_1.z.string().min(16),
    JWT_EXPIRES_IN: zod_1.z.string().default('8h'),
});
var env_debug_1 = require("./env-debug");
Object.defineProperty(exports, "envDebug", { enumerable: true, get: function () { return env_debug_1.envDebug; } });
//# sourceMappingURL=index.js.map