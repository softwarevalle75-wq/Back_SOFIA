"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.paginated = paginated;
exports.fail = fail;
function ok(data, meta) {
    return { data, error: null, ...(meta ? { meta } : {}) };
}
function paginated(data, total, page, limit) {
    return {
        data,
        error: null,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
}
function fail(code, message, details) {
    return { data: null, error: { code, message, ...(details !== undefined ? { details } : {}) } };
}
//# sourceMappingURL=response.js.map