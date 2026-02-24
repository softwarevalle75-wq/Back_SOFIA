import { z } from 'zod';
/**
 * Valida variables de entorno contra un schema Zod.
 * Lanza error legible si falta algo.
 */
export declare function validateEnv<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.infer<z.ZodObject<T>>;
/** Schema base compartido por todos los MS */
export declare const BaseEnvSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "production", "test"]>>;
    DATABASE_URL: z.ZodString;
    JWT_SECRET: z.ZodString;
    JWT_EXPIRES_IN: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    NODE_ENV: "development" | "production" | "test";
    DATABASE_URL: string;
    JWT_SECRET: string;
    JWT_EXPIRES_IN: string;
}, {
    DATABASE_URL: string;
    JWT_SECRET: string;
    NODE_ENV?: "development" | "production" | "test" | undefined;
    JWT_EXPIRES_IN?: string | undefined;
}>;
export { envDebug } from './env-debug';
//# sourceMappingURL=index.d.ts.map