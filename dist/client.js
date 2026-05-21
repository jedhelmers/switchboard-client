// Tiny fetch wrapper. Two auth modes, picked by configure():
//   • Cookie (default) — HttpOnly + same-origin. Browser sends it; we just
//     set credentials: 'include'. This is what /web uses against its own
//     deployment.
//   • Bearer — `configure({ getToken })` switches the client to fetch a
//     short-lived user token (minted by the parent app's backend via
//     /v1/auth/sso/exchange) and attach it as `Authorization: Bearer ...`.
//     Cookies are NOT sent in this mode so a SwitchBoard cookie from a prior
//     session doesn't leak into a parent-app embedded UI.
let config = { baseURL: '/api' };
export function configure(next) {
    config = { ...config, ...next };
    if (config.baseURL.endsWith('/')) {
        config.baseURL = config.baseURL.replace(/\/+$/, '');
    }
}
export function getConfig() {
    return config;
}
export class APIError extends Error {
    status;
    detail;
    constructor(status, title, detail) {
        super(title);
        this.status = status;
        this.detail = detail;
    }
}
async function request(method, path, body) {
    const headers = {};
    if (body !== undefined)
        headers['content-type'] = 'application/json';
    // Bearer path: omit cookies entirely so a stale SwitchBoard session cookie can't
    // outrank the token. Cookie path: include credentials so HttpOnly survives.
    let credentials = 'include';
    if (config.getToken) {
        const token = await config.getToken();
        if (token)
            headers['authorization'] = `Bearer ${token}`;
        credentials = 'omit';
    }
    const res = await fetch(config.baseURL + path, {
        method,
        credentials,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204)
        return undefined;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
        const title = (data && data.title) || `HTTP ${res.status}`;
        const detail = (data && data.detail) || '';
        throw new APIError(res.status, title, detail);
    }
    return data;
}
export const api = {
    get: (p) => request('GET', p),
    post: (p, body) => request('POST', p, body),
    patch: (p, body) => request('PATCH', p, body),
    del: (p) => request('DELETE', p),
};
//# sourceMappingURL=client.js.map