# @stack/client

TypeScript client, React Query hooks, and WebSocket helper for the
[Stack](https://github.com/your-org/stack) chat platform. This package is
the same code the official web app uses — it ships every endpoint type, the
realtime event union, and a hook for every read + mutation surface in the
REST API.

It does **not** ship UI components. Build your own chat UI on top of these
hooks (recommended), or, for non-React targets (Android, Swift, etc.), read
[the API + WebSocket docs](https://github.com/your-org/stack/blob/main/API.md)
to roll a native client.

## Install

```bash
npm install @stack/client @tanstack/react-query react
```

Peer deps: React 18 or 19, `@tanstack/react-query` 5+.

## Quick start

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure, useMe, useMessages, useRealtime } from '@stack/client'

// Point the client at your Stack server. Call once on app boot.
configure({ baseURL: 'https://chat.example.com/api' })

const qc = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={qc}>
      <Chat />
    </QueryClientProvider>
  )
}

function Chat() {
  const { data: me } = useMe()
  useRealtime() // opens a single shared WebSocket; cache patches happen automatically

  if (!me) return <Login />
  return <ChannelView channelId="..." />
}
```

The session is a same-origin HttpOnly cookie set by `POST /v1/auth/login`,
so all requests carry it automatically via `credentials: 'include'`. For
cross-origin embeds, your Stack server must respond with the appropriate
`Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials` headers.

## Configuration

```ts
import { configure } from '@stack/client'

configure({
  // Where REST requests go. Absolute URL for cross-origin embeds; same-origin
  // path prefix (e.g. '/api') when your app sits behind the same domain.
  baseURL: 'https://chat.example.com/api',

  // Optional WebSocket URL override. Defaults to baseURL with ws(s):// + /v1/realtime.
  wsURL: 'wss://chat.example.com/api/v1/realtime',
})
```

Configuration is a process-global. There's no per-instance Client object;
one app talks to one Stack server. Holler if you need multi-tenant.

## What's in the package

### Types

Every server response shape, exported from the root:

```ts
import type {
  User, Workspace, Channel, Message, Member, Reaction,
  AttachmentFile, DMSummary, Invite, InviteWithToken,
  PresignResponse, OperatorAuditEntry, OperatorChannel,
  OperatorUser, OperatorWorkspace,
} from '@stack/client'
```

### Hooks

Conventionally named after the verb + resource. All return TanStack Query
shapes (`{ data, isLoading, error, ... }` for queries, `{ mutate, isPending,
... }` for mutations).

**Auth + profile**
- `useMe()` — current user; `null` when logged out
- `useLogin()`, `useLogout()`
- `useUpdateMe()`, `uploadAvatar(file)`
- `useAcceptInvite()`

**Workspaces + channels**
- `useMyWorkspaces()`
- `useChannels(slug)`, `usePublicChannels(slug)`
- `useMembers(slug)`
- `useCreateChannel(slug)`, `useJoinChannel(slug)`,
  `useArchiveChannel(slug)`, `useDeleteChannel(slug)`, `useLeaveChannel(slug)`

**Messages**
- `useMessages(channelId, realtimeOpen, anchorId?)` — infinite query
- `usePostMessage(channelId)`
- `useEditMessage(channelId)`, `useDeleteMessage(channelId)`
- `useToggleReaction(channelId, currentUserID)`
- `useSearchMessages(slug, debouncedQuery)`

**Threads**
- `useThreadReplies(rootId)`
- `usePostThreadReply(rootId, channelId)`

**DMs**
- `useDMs(slug)`, `useStartDM(slug)`

**Unread**
- `useUnreadCounts(slug)`, `useMarkChannelRead(slug)`

**Typing**
- `useTypingState(channelId, currentUserID)`, `useTypingNotifier(channelId)`

**Invites**
- `useWorkspaceInvites(slug)`, `useCreateWorkspaceInvite(slug)`,
  `useRevokeWorkspaceInvite(slug)`

**Realtime**
- `useRealtime()` — opens one shared WebSocket per app, returns connection state

**Attachments**
- `uploadAttachment(workspaceSlug, file, onProgress?)` — presign + PUT + finalize

**Operator (admin)**
- `useOperatorStats()`, `useOperatorWorkspaces()`, `useOperatorChannels()`,
  `useOperatorDMs()`, `useOperatorUsers()`, `useOperatorAudit()`
- `useOpCreateUser()`, `useOpLockUser()`, `useOpUnlockUser()`,
  `useOpDeleteUser()`, `useOpForceLogoutUser()`,
  `useOpCreateWorkspace()`, `useOpSuspendWorkspace()`,
  `useOpUnsuspendWorkspace()`, `useOpDeleteWorkspace()`

### Realtime

```ts
import { RealtimeClient, realtimeURL, type RealtimeEvent } from '@stack/client'

const c = new RealtimeClient(realtimeURL())
c.on((ev: RealtimeEvent) => {
  console.log(ev.type, ev)
})
c.start()
```

The `useRealtime()` hook handles the common case (one shared connection,
state piped into React Query caches). Drop down to `RealtimeClient` for
custom subscription patterns.

### Raw API client

For one-off requests outside the hook surface:

```ts
import { api, APIError } from '@stack/client'

try {
  const ws = await api.get<Workspace>(`/v1/workspaces/${slug}`)
} catch (err) {
  if (err instanceof APIError && err.status === 404) { /* ... */ }
}
```

## Versioning

Tracks the server's `/v1` API. Breaking changes to that API would land in
`/v2` and a new major version of this package.

## See also

- [API.md](https://github.com/your-org/stack/blob/main/API.md) — full HTTP reference
- [REALTIME.md](https://github.com/your-org/stack/blob/main/REALTIME.md) — WebSocket protocol
