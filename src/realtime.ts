// Tiny WebSocket client. Auth is via the session cookie (sent automatically by the
// browser on same-origin WS upgrades). Reconnects with capped exponential backoff.

import { getConfig, type Message } from './client'

export type RealtimeEvent =
  | { type: 'message.created'; workspace_id: string; channel_id: string; message_id: string; payload: Message; emitted_at: string }
  | { type: 'message.updated'; workspace_id: string; channel_id: string; message_id: string; payload: Message; emitted_at: string }
  | { type: 'message.deleted'; workspace_id: string; channel_id: string; message_id: string; payload: Message; emitted_at: string }
  | { type: 'typing.started'; workspace_id: string; channel_id: string; user_id: string; emitted_at: string }
  | { type: 'typing.stopped'; workspace_id: string; channel_id: string; user_id: string; emitted_at: string }
  // Membership events are scoped to the affected user only (the server's
  // hub filters by target_user_id before delivery). Receiving one means
  // *I* was added to or removed from a channel — the client refreshes its
  // channels/dms lists in response.
  | { type: 'membership.added'; workspace_id: string; channel_id: string; target_user_id: string; emitted_at: string }
  | { type: 'membership.removed'; workspace_id: string; channel_id: string; target_user_id: string; emitted_at: string }

export type Listener = (ev: RealtimeEvent) => void

export type ConnectionState = 'connecting' | 'open' | 'closed'

export class RealtimeClient {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private stateListeners = new Set<(s: ConnectionState) => void>()
  private state: ConnectionState = 'closed'
  private retryDelay = 500
  private readonly maxDelay = 30_000
  private stopped = false
  private reconnectTimer: number | null = null

  constructor(private url: string) {}

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setState('closed')
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onState(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  private setState(s: ConnectionState) {
    if (this.state === s) return
    this.state = s
    this.stateListeners.forEach((l) => l(s))
  }

  private connect() {
    if (this.stopped) return
    this.setState('connecting')

    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      this.retryDelay = 500
      this.setState('open')
    }

    ws.onmessage = (evt) => {
      let parsed: RealtimeEvent
      try {
        parsed = JSON.parse(evt.data)
      } catch {
        return
      }
      this.listeners.forEach((l) => l(parsed))
    }

    ws.onerror = () => {
      // Browser fires error before close; close handler does the actual reconnect.
    }

    ws.onclose = () => {
      this.ws = null
      this.setState('closed')
      if (this.stopped) return
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.retryDelay)
      this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay)
    }
  }
}

// Builds the WS URL. Resolution order:
//   1. config.wsURL — explicit override set via configure().
//   2. config.baseURL — absolute http(s) → swap to ws(s) + /v1/realtime.
//      Relative (e.g. '/api') → build from window.location.
export function realtimeURL(): string {
  const cfg = getConfig()
  if (cfg.wsURL) return cfg.wsURL
  const base = cfg.baseURL
  if (/^https?:\/\//i.test(base)) {
    return base.replace(/^http/i, 'ws') + '/v1/realtime'
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${base}/v1/realtime`
}
