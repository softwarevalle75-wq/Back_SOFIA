"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceRequest = serviceRequest;
async function serviceRequest(baseUrl, path, options = {}) {
    const { method = 'GET', body, headers = {}, timeout = 10_000 } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) {
            throw new Error(`Service ${baseUrl}${path} responded ${res.status}: ${JSON.stringify(json)}`);
        }
        return json;
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=index.js.map