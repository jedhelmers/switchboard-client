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

import { api, getConfig, type Message } from './client'

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
  // Huddle lifecycle — channel-scoped fanout like message events. Every
  // member of the channel hears these. user_id is the actor (joiner /
  // leaver); started_by lives in the payload for `huddle.started`.
  | {
      type: 'huddle.started'
      workspace_id: string
      channel_id: string
      payload: { huddle_id: string; started_by: string; started_at: string }
      emitted_at: string
    }
  | {
      type: 'huddle.ended'
      workspace_id: string
      channel_id: string
      payload: { huddle_id: string; ended_at: string; duration_seconds: number }
      emitted_at: string
    }
  | {
      type: 'huddle.participant_joined'
      workspace_id: string
      channel_id: string
      user_id: string
      payload: { huddle_id: string; joined_at: string }
      emitted_at: string
    }
  | {
      type: 'huddle.participant_left'
      workspace_id: string
      channel_id: string
      user_id: string
      payload: { huddle_id: string; left_at: string }
      emitted_at: string
    }
  // Recording lifecycle — fired only when a participant opts in by hitting
  // the Record button. The UI surfaces the consent banner + chime on
  // huddle.recording_started across every connected client in the channel.
  | {
      type: 'huddle.recording_started'
      workspace_id: string
      channel_id: string
      payload: { recording_id: string; huddle_id: string; started_by: string; started_at: string }
      emitted_at: string
    }
  | {
      type: 'huddle.recording_stopped'
      workspace_id: string
      channel_id: string
      payload: { recording_id: string; huddle_id: string; stopped_at: string }
      emitted_at: string
    }
  | {
      type: 'huddle.recording_ready'
      workspace_id: string
      channel_id: string
      payload: { recording_id: string; huddle_id: string; transcript_message_id: string }
      emitted_at: string
    }
  | {
      type: 'huddle.recording_failed'
      workspace_id: string
      channel_id: string
      payload: { recording_id: string; huddle_id: string; reason: string }
      emitted_at: string
    }

export type Listener = (ev: RealtimeEvent) => void

export type ConnectionState = 'connecting' | 'open' | 'closed'

// URLResolver returns the full ws(s):// URL to dial. Async to allow the
// bearer path to fetch a fresh ticket per connect attempt. Strings are
// accepted at the constructor for backward compatibility with the
// pre-multi-app cookie-only callers.
export type URLResolver = string | (() => Promise<string>)

export class RealtimeClient {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private stateListeners = new Set<(s: ConnectionState) => void>()
  private state: ConnectionState = 'closed'
  private retryDelay = 500
  private readonly maxDelay = 30_000
  private stopped = false
  private reconnectTimer: number | null = null

  constructor(private url: URLResolver) {}

  private async resolveURL(): Promise<string> {
    return typeof this.url === 'function' ? this.url() : this.url
  }

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

  private async connect() {
    if (this.stopped) return
    this.setState('connecting')

    let url: string
    try {
      url = await this.resolveURL()
    } catch {
      // URL resolution failed (ticket mint failed, network glitch). Treat
      // as a connection failure: backoff + retry. Don't get stuck in
      // 'connecting' forever.
      this.setState('closed')
      if (!this.stopped) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), this.retryDelay)
        this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay)
      }
      return
    }

    const ws = new WebSocket(url)
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

// realtimeURLProvider returns the right async URL resolver for the current
// client config. Bearer mode mints a one-shot ticket per connect; cookie
// mode returns the static URL.
//
// useRealtime calls this once at mount time. The returned function is
// invoked fresh on every connect attempt — tickets are single-use, and
// reusing one fails closed at the server.
export function realtimeURLProvider(): () => Promise<string> {
  const cfg = getConfig()
  if (!cfg.getToken) {
    // Cookie auth: nothing dynamic to resolve.
    const url = realtimeURL()
    return async () => url
  }
  return async () => {
    const { ticket } = await api.post<{ ticket: string; expires_in: number }>(
      '/v1/auth/realtime-ticket',
    )
    const sep = realtimeURL().includes('?') ? '&' : '?'
    return realtimeURL() + sep + 'ticket=' + encodeURIComponent(ticket)
  }
}
