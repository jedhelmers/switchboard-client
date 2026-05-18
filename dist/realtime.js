// Tiny WebSocket client. Two auth paths, picked by client configure():
//   • Cookie (default) — same-origin upgrade carries the HttpOnly session
//     cookie. URL is sync, no extra round trip.
//   • Bearer — the browser can't set Authorization on the WS upgrade, so we
//     POST /v1/auth/realtime-ticket first (using the bearer user token),
//     append ?ticket=<one-shot> to the URL, and connect. Tickets are
//     consumed atomically by the server so reconnect re-fetches.
//
// Reconnects with capped exponential backoff. Each reconnect re-resolves
// the URL, so a fresh ticket is minted on every attempt — never reused.
import { api, getConfig } from './client';
export class RealtimeClient {
    url;
    ws = null;
    listeners = new Set();
    stateListeners = new Set();
    state = 'closed';
    retryDelay = 500;
    maxDelay = 30_000;
    stopped = false;
    reconnectTimer = null;
    constructor(url) {
        this.url = url;
    }
    async resolveURL() {
        return typeof this.url === 'function' ? this.url() : this.url;
    }
    start() {
        this.stopped = false;
        this.connect();
    }
    stop() {
        this.stopped = true;
        if (this.reconnectTimer != null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.setState('closed');
    }
    on(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    onState(listener) {
        this.stateListeners.add(listener);
        listener(this.state);
        return () => this.stateListeners.delete(listener);
    }
    setState(s) {
        if (this.state === s)
            return;
        this.state = s;
        this.stateListeners.forEach((l) => l(s));
    }
    async connect() {
        if (this.stopped)
            return;
        this.setState('connecting');
        let url;
        try {
            url = await this.resolveURL();
        }
        catch {
            // URL resolution failed (ticket mint failed, network glitch). Treat
            // as a connection failure: backoff + retry. Don't get stuck in
            // 'connecting' forever.
            this.setState('closed');
            if (!this.stopped) {
                this.reconnectTimer = window.setTimeout(() => this.connect(), this.retryDelay);
                this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay);
            }
            return;
        }
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => {
            this.retryDelay = 500;
            this.setState('open');
        };
        ws.onmessage = (evt) => {
            let parsed;
            try {
                parsed = JSON.parse(evt.data);
            }
            catch {
                return;
            }
            this.listeners.forEach((l) => l(parsed));
        };
        ws.onerror = () => {
            // Browser fires error before close; close handler does the actual reconnect.
        };
        ws.onclose = () => {
            this.ws = null;
            this.setState('closed');
            if (this.stopped)
                return;
            this.reconnectTimer = window.setTimeout(() => this.connect(), this.retryDelay);
            this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay);
        };
    }
}
// Builds the WS URL. Resolution order:
//   1. config.wsURL — explicit override set via configure().
//   2. config.baseURL — absolute http(s) → swap to ws(s) + /v1/realtime.
//      Relative (e.g. '/api') → build from window.location.
export function realtimeURL() {
    const cfg = getConfig();
    if (cfg.wsURL)
        return cfg.wsURL;
    const base = cfg.baseURL;
    if (/^https?:\/\//i.test(base)) {
        return base.replace(/^http/i, 'ws') + '/v1/realtime';
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${base}/v1/realtime`;
}
// realtimeURLProvider returns the right async URL resolver for the current
// client config. Bearer mode mints a one-shot ticket per connect; cookie
// mode returns the static URL.
//
// useRealtime calls this once at mount time. The returned function is
// invoked fresh on every connect attempt — tickets are single-use, and
// reusing one fails closed at the server.
export function realtimeURLProvider() {
    const cfg = getConfig();
    if (!cfg.getToken) {
        // Cookie auth: nothing dynamic to resolve.
        const url = realtimeURL();
        return async () => url;
    }
    return async () => {
        const { ticket } = await api.post('/v1/auth/realtime-ticket');
        const sep = realtimeURL().includes('?') ? '&' : '?';
        return realtimeURL() + sep + 'ticket=' + encodeURIComponent(ticket);
    };
}
//# sourceMappingURL=realtime.js.map