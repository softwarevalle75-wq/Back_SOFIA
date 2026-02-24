"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_URLS = exports.PORTS = void 0;
// ─── Puertos por microservicio ─────────────────────
exports.PORTS = {
    API_GATEWAY: 3000,
    MS_IDENTIDAD: 3001,
    MS_TELEGRAM: 3050,
    MS_WHATSAPP: 3051,
    MS_CASOS: 3003,
    MS_IA: 8000, // FastAPI Python
    MS_CITAS: 3004,
    MS_ESTUDIANTES: 3005,
    MS_DASHBOARD: 3006,
    MS_CONSENTIMIENTOS: 3007,
    MS_NORMATIVA: 3008,
    MS_REPORTES: 3009,
    DASHBOARD_WEB: 5173,
};
// ─── URLs internas (default, sobreescribibles por env) ──
exports.SERVICE_URLS = {
    MS_IDENTIDAD: `http://localhost:${exports.PORTS.MS_IDENTIDAD}`,
    MS_TELEGRAM: `http://localhost:${exports.PORTS.MS_TELEGRAM}`,
    MS_WHATSAPP: `http://localhost:${exports.PORTS.MS_WHATSAPP}`,
    MS_CASOS: `http://localhost:${exports.PORTS.MS_CASOS}`,
    MS_IA: `http://localhost:${exports.PORTS.MS_IA}`,
    MS_CITAS: `http://localhost:${exports.PORTS.MS_CITAS}`,
    MS_ESTUDIANTES: `http://localhost:${exports.PORTS.MS_ESTUDIANTES}`,
    MS_DASHBOARD: `http://localhost:${exports.PORTS.MS_DASHBOARD}`,
    MS_CONSENTIMIENTOS: `http://localhost:${exports.PORTS.MS_CONSENTIMIENTOS}`,
    MS_NORMATIVA: `http://localhost:${exports.PORTS.MS_NORMATIVA}`,
    MS_REPORTES: `http://localhost:${exports.PORTS.MS_REPORTES}`,
};
//# sourceMappingURL=constants.js.map