// Tiny fetch wrapper. Two auth modes, picked by configure():
//   • Cookie (default) — HttpOnly + same-origin. Browser sends it; we just
//     set credentials: 'include'. This is what /web uses against its own
//     deployment.
//   • Bearer — `configure({ getToken })` switches the client to fetch a
//     short-lived user token (minted by the parent app's backend via
//     /v1/auth/sso/exchange) and attach it as `Authorization: Bearer ...`.
//     Cookies are NOT sent in this mode so a SwitchBoard cookie from a prior
//     session doesn't leak into a parent-app embedded UI.

export type ClientConfig = {
  // Absolute base URL or same-origin path prefix. Trailing slashes stripped.
  // Examples: '/api'  •  'https://chat.example.com/api'  •  'http://localhost:8080'
  baseURL: string
  // Optional WebSocket URL override; if unset the realtime client derives one
  // from baseURL (ws:// or wss:// + the same host + /v1/realtime).
  wsURL?: string
  // When set, every REST request attaches `Authorization: Bearer <token>`
  // and omits cookies. The function is called per request, so it should be
  // cheap — cache + refresh the token inside it (typically against your own
  // backend, which holds the SwitchBoard API key and calls /v1/auth/sso/exchange).
  // Return null to send the request unauthenticated (will 401).
  getToken?: () => Promise<string | null>
}

let config: ClientConfig = { baseURL: '/api' }

export function configure(next: Partial<ClientConfig>): void {
  config = { ...config, ...next }
  if (config.baseURL.endsWith('/')) {
    config.baseURL = config.baseURL.replace(/\/+$/, '')
  }
}

export function getConfig(): Readonly<ClientConfig> {
  return config
}

export class APIError extends Error {
  status: number
  detail: string
  constructor(status: number, title: string, detail: string) {
    super(title)
    this.status = status
    this.detail = detail
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'

  // Bearer path: omit cookies entirely so a stale SwitchBoard session cookie can't
  // outrank the token. Cookie path: include credentials so HttpOnly survives.
  let credentials: RequestCredentials = 'include'
  if (config.getToken) {
    const token = await config.getToken()
    if (token) headers['authorization'] = `Bearer ${token}`
    credentials = 'omit'
  }

  const res = await fetch(config.baseURL + path, {
    method,
    credentials,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const title = (data && data.title) || `HTTP ${res.status}`
    const detail = (data && data.detail) || ''
    throw new APIError(res.status, title, detail)
  }
  return data as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, body?: unknown) => request<T>('POST', p, body),
  patch: <T>(p: string, body?: unknown) => request<T>('PATCH', p, body),
  del: <T>(p: string) => request<T>('DELETE', p),
}

// ---- typed shapes returned by the server -----------------------------------

export type User = {
  id: string
  email: string
  display_name: string
  avatar_url?: string
  timezone: string
  locale: string
  is_operator: boolean
}

export type Workspace = {
  id: string
  slug: string
  name: string
  description?: string
  icon_url?: string
  invite_policy: string
}

export type Channel = {
  id: string
  workspace_id: string
  kind: 'public' | 'private' | 'dm' | 'group_dm'
  slug?: string
  name?: string
  topic?: string
  description?: string
  archived: boolean
  created_by_user_id?: string
  created_at?: string
}

export type Message = {
  id: string
  workspace_id: string
  channel_id: string
  user_id?: string
  parent_message_id?: string
  thread_root_id?: string
  kind: string
  text: string
  // Rich content as TipTap JSON. Optional — older messages and plain-text
  // posts have only `text`. The renderer falls back to text when this is
  // missing or blank. We use `unknown` here because the `JSONContent` type
  // lives in TipTap's package; consumers cast at use site.
  payload?: unknown
  attachments?: AttachmentFile[]
  reactions?: Reaction[]
  // Mentions present on the message. user_id is set for kind === 'user'
  // and absent for the channel-wide kinds. Computed server-side from the
  // mention_notifications table on every list path.
  mentions?: Mention[]
  // Populated only on root (parent) messages by the channel-list endpoint.
  // Replies themselves leave it absent.
  reply_count?: number
  last_reply_at?: string
  // Pin metadata — `pinned` is the canonical "is pinned" flag; the *_by_user_id
  // and *_at fields fill in when pinned is true. A pinned message is one with
  // a row in the server-side message_pins table.
  pinned?: boolean
  pinned_by_user_id?: string
  pinned_at?: string
  edited_at?: string
  deleted_at?: string
  created_at: string
}

export type Reaction = {
  emoji: string
  count: number
  user_ids: string[]
}

export type MentionKind = 'user' | 'channel' | 'here' | 'everyone'

export type Mention = {
  kind: MentionKind
  // Only present for kind === 'user'.
  user_id?: string
}

export type MentionNotification = {
  id: string
  workspace_id: string
  channel_id: string
  message_id: string
  mention_kind: MentionKind
  mentioner_user_id?: string
  read_at?: string
  created_at: string
}

// Per-channel mention count response from GET /workspaces/{slug}/mention_counts.
// `by_channel` is keyed by channel id; `total` is the workspace-wide sum used
// for the bell-icon badge.
export type MentionCounts = {
  by_channel: Record<string, number>
  total: number
}

export type AttachmentFile = {
  id: string
  workspace_id: string
  filename: string
  mime_type: string
  bytes: number
  status: 'pending' | 'ready' | 'deleted'
  url?: string // presigned GET; present in message responses, empty otherwise
  image_width?: number
  image_height?: number
  created_at?: string
}

export type PresignResponse = {
  file_id: string
  upload_url: string
  object_key: string
}

export type Member = {
  user_id: string
  email: string
  display_name: string
  avatar_url?: string
  role: string
  joined_at?: string
}

export type DMSummary = {
  id: string
  kind: 'dm' | 'group_dm'
  other_user_ids: string[]
  other_display_names: string[]
  other_emails: string[]
  created_at?: string
}

export type Invite = {
  id: string
  workspace_id: string
  email?: string
  role: string
  max_uses: number
  used_count: number
  expires_at?: string
  revoked_at?: string
  created_at?: string
}

export type InviteWithToken = Invite & { token: string }

// ---- operator dashboard ---------------------------------------------------

export type OperatorStats = {
  users: number
  operators: number
  workspaces: number
  channels: number
  public_channels: number
  private_channels: number
  dms: number
  messages: number
  messages_24h: number
  active_users_7d: number
  pending_invites: number
}

export type OperatorWorkspace = {
  id: string
  slug: string
  name: string
  status: string
  owner_user_ids: string[]
  member_count: number
  channel_count: number
  message_count: number
  last_message_at?: string
  created_at?: string
}

export type OperatorChannel = {
  id: string
  workspace_id: string
  workspace_slug: string
  workspace_name: string
  kind: 'public' | 'private'
  slug?: string
  name?: string
  topic?: string
  archived: boolean
  member_count: number
  message_count: number
  last_message_at?: string
  created_at?: string
}

export type OperatorDM = {
  id: string
  workspace_id: string
  workspace_slug: string
  kind: 'dm' | 'group_dm'
  participant_emails: string[]
  participant_names: string[]
  message_count: number
  last_message_at?: string
  created_at?: string
}

export type Health = Record<string, string>

export type OperatorUser = {
  id: string
  email: string
  display_name: string
  is_operator: boolean
  status: 'active' | 'suspended' | 'deleted'
  workspace_count: number
  owned_workspace_count: number
  last_login_at?: string
  created_at?: string
}

// Parent app registered with SwitchBoard. Each has its own walled-garden workspaces
// and end users — there is no cross-app messaging. The synthetic 'default'
// app holds native password-auth users (operators).
export type OperatorApp = {
  id: string
  slug: string
  name: string
  description?: string
  allowed_origins: string[]
  status: 'active' | 'suspended'
  created_at: string
}

// API key metadata. The plaintext is NEVER present on read paths — only
// the prefix and label. See OperatorAPIKeyWithPlaintext for the one-time
// creation response.
export type OperatorAPIKey = {
  id: string
  app_id: string
  key_prefix: string
  label: string
  scopes: string[]
  last_used_at?: string
  revoked_at?: string
  created_at: string
}

// Returned ONCE at key creation. Surface the plaintext to the operator
// immediately and discard; it cannot be recovered.
export type OperatorAPIKeyWithPlaintext = OperatorAPIKey & { plaintext: string }

export type OperatorAuditEntry = {
  id: string
  actor_user_id: string
  actor_email: string
  action: string
  target_type?: string
  target_id?: string
  metadata?: Record<string, unknown>
  ip?: string
  user_agent?: string
  created_at?: string
}

export type WorkspaceMembership = {
  workspace_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member' | 'guest' | 'bot'
}

// ---- jams --------------------------------------------------------------
//
// Jams are live audio/video/screen-share rooms scoped to a channel (or
// DM — DMs are channels under the hood). The SwitchBoard server never touches
// media bytes; it mints a short-lived LiveKit JWT and broadcasts jam.*
// realtime events. The client passes `livekit_url` + `livekit_token` to
// LiveKit's own SDK (`@livekit/components-react`) to actually join the room.

export type JamParticipant = {
  user_id: string
  joined_at: string
}

export type Jam = {
  id: string
  channel_id: string
  workspace_id: string
  started_by: string
  started_at: string
  // Set when the jam has ended. An active jam always has this absent.
  ended_at?: string
  participants: JamParticipant[]
}

// Returned by POST /v1/channels/{id}/jam/join. Caller hands livekit_url
// + livekit_token to <LiveKitRoom> from @livekit/components-react. Tokens
// are short-lived (default 10m); re-calling join refreshes the token
// without disrupting an existing connection.
export type JamJoinResponse = {
  jam: Jam
  livekit_url: string
  livekit_token: string
  livekit_token_expires_at: string
  room: string
}

// Returned by GET /v1/channels/{id}/jam. `jam` is null when no
// jam is active in the channel — clients should render the "start
// jam" affordance in that case.
export type JamStateResponse = {
  jam: Jam | null
}

// ---- jam recordings ----------------------------------------------------
//
// Opt-in recording with self-hosted transcription. The UI surfaces a Record
// button inside the jam; clicking it fires jam.recording_started over
// the realtime channel so every participant sees the consent banner
// simultaneously. See JAM.md for the consent model.

export type JamRecordingStatus =
  | 'recording'   // egress is active; participants see the REC banner
  | 'processing' // egress stopped, transcription job is running
  | 'ready'      // transcript inserted + system message posted to the channel
  | 'failed'     // pipeline failed; failed_reason is set
  | 'cancelled'  // future: explicit cancel without transcript

export type JamRecording = {
  id: string
  jam_id: string
  channel_id: string
  workspace_id: string
  started_by: string
  started_at: string
  ended_at?: string
  status: JamRecordingStatus
  // Egress job IDs the server tracks for stop. Not interesting to the UI
  // except for debugging — exposed for completeness.
  egress_ids?: string[]
  // Set once the auto-posted "📝 Transcript ready" message lands in the
  // channel. UIs can use this to scroll the channel to the message or to
  // light up the "view transcript" affordance.
  transcript_message_id?: string
  failed_reason?: string
}

export type JamTranscriptSegment = {
  speaker_user_id: string
  segment_index: number
  started_offset_ms: number
  ended_offset_ms: number
  text: string
}

// Returned by GET /v1/recordings/:id/transcript. Until status='ready' the
// transcript field is null and clients should poll or wait for the
// jam.recording_ready realtime event.
export type JamTranscriptResponse = {
  recording: JamRecording
  transcript: JamTranscriptSegment[] | null
}

// Returned by POST /v1/channels/:id/jam/recording/start. The body is
// the freshly-inserted recording row. If a recording is already in
// progress the server returns 409 — see useStartJamRecording's error
// handling.
export type JamRecordingStartResponse = {
  recording: JamRecording
}

// Returned by GET /v1/channels/:id/recordings. Newest-first, all
// statuses. Clients filter to status='recording' to find the live one
// or render the rest as a history list.
export type JamRecordingsListResponse = {
  recordings: JamRecording[]
}
