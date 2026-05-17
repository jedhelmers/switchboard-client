// Tiny fetch wrapper. Cookie is HttpOnly + same-origin, so we just need
// credentials: 'include' so the browser sends it.
//
// `configure()` lets consumers point the client at any server. The default
// `/api` assumes the app is served behind a reverse proxy that forwards /api
// to the Stack server — which is how the bundled web app is deployed. For
// any other shape (cross-origin SPA, native shell, etc.) call configure()
// during app bootstrap.

export type ClientConfig = {
  // Absolute base URL or same-origin path prefix. Trailing slashes stripped.
  // Examples: '/api'  •  'https://chat.example.com/api'  •  'http://localhost:8080'
  baseURL: string
  // Optional WebSocket URL override; if unset the realtime client derives one
  // from baseURL (ws:// or wss:// + the same host + /v1/realtime).
  wsURL?: string
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
  const res = await fetch(config.baseURL + path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
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
  owner_user_id: string
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
  owner_user_id: string
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
