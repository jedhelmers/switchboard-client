// Plugin registries.
//
// Two extension points, intentionally tiny:
//   1. Slash commands — `/giphy cat` in the composer runs a handler instead of
//      sending raw text. The handler returns a message body (text + payload +
//      optional file attachments) and the composer sends it as if the user
//      typed it.
//   2. Payload renderers — a registered React component is rendered in place
//      of the default TipTap reader when a message's payload has a non-doc
//      shape like `{ type: 'giphy', url, ... }`.
//
// Both registries are *process-global* by design. Each call to register
// returns an unsubscribe function so tests can clean up. Re-registering the
// same name silently overwrites the previous handler — convenient during
// hot-reload, and the alternative (throwing on dup) makes dev cycles painful.

import type { ComponentType } from 'react'

// ---- slash commands --------------------------------------------------------

// Context handed to every slash-command handler. Carries enough surface for a
// handler to make scoped HTTP calls (workspace-scoped uploads, etc.) without
// reaching into the app's React tree. Add fields here when a built-in plugin
// needs them — we don't want plugins poking at React-Query or auth state.
export type SlashCommandContext = {
  channelId: string
  workspaceSlug: string
  currentUserID: string
  // True when invoked inside a thread composer. Most plugins don't need to
  // care, but some (like a /poll command later) might gate on thread mode.
  isThread: boolean
}

// What a slash-command handler resolves to. The composer takes this and feeds
// it into the normal post-message mutation — so plugins ride the same
// validation, optimistic update, and realtime echo paths as user-typed posts.
// Return `null` to abort silently (e.g. user dismissed a picker UI inside
// the handler).
export type SlashCommandResult = {
  text?: string
  payload?: unknown
  file_ids?: string[]
} | null

export type SlashCommand = {
  // Without the leading slash. Lowercase. Validated on register.
  name: string
  // One-line description shown in the typeahead dropdown.
  description?: string
  // Argument hint shown after the command in the dropdown ("<query>").
  usage?: string
  // Called when the user submits `/{name} {args}`. May be sync or async.
  run: (args: string, ctx: SlashCommandContext) => SlashCommandResult | Promise<SlashCommandResult>
}

const slashCommands = new Map<string, SlashCommand>()

// registerSlashCommand validates + stores a handler. Returns an unsubscribe
// closure so a consumer can clean up in a hot-reload or unmount.
export function registerSlashCommand(cmd: SlashCommand): () => void {
  const name = cmd.name.toLowerCase().trim()
  if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) {
    throw new Error(
      `slash command name must be lowercase alphanumeric (got "${cmd.name}")`,
    )
  }
  slashCommands.set(name, { ...cmd, name })
  return () => {
    // Only unregister if the current entry is still ours — a later
    // re-register shouldn't be wiped by a stale unsubscribe.
    if (slashCommands.get(name) === cmd) slashCommands.delete(name)
  }
}

export function getSlashCommand(name: string): SlashCommand | undefined {
  return slashCommands.get(name.toLowerCase())
}

// List registered commands. Returned alphabetically — the typeahead consumer
// is expected to do its own filtering.
export function listSlashCommands(): SlashCommand[] {
  return Array.from(slashCommands.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

// parseSlashInput pulls `{name, args}` from a string like "/giphy cat". The
// composer uses this to decide whether to intercept the send. Returns null
// when the input doesn't start with a slash + non-empty word.
export function parseSlashInput(input: string): { name: string; args: string } | null {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith('/')) return null
  const rest = trimmed.slice(1)
  // First whitespace splits name from arguments. A bare "/" or "/   " is not
  // a command — return null so the composer treats it as plain text.
  const match = rest.match(/^([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return { name: match[1]!.toLowerCase(), args: match[2]?.trim() ?? '' }
}

// ---- payload renderers -----------------------------------------------------

// A renderer is a React component that takes the parsed payload and renders
// it. The reader (MessageRender) calls into this registry when a payload has
// a non-TipTap shape — specifically, when `payload.type` is something other
// than 'doc'. Plugin-defined types should namespace themselves with a short
// stable string ('giphy', 'poll', 'youtube', etc.) and stick to JSON-safe
// fields so server-side storage round-trips cleanly.

export type PayloadRendererProps<T = unknown> = {
  payload: T
}

export type PayloadRenderer<T = unknown> = ComponentType<PayloadRendererProps<T>>

const payloadRenderers = new Map<string, PayloadRenderer<unknown>>()

export function registerPayloadRenderer<T = unknown>(
  type: string,
  component: PayloadRenderer<T>,
): () => void {
  const key = type.trim()
  if (!key) throw new Error('payload renderer type must be non-empty')
  payloadRenderers.set(key, component as PayloadRenderer<unknown>)
  return () => {
    if (payloadRenderers.get(key) === component) payloadRenderers.delete(key)
  }
}

export function getPayloadRenderer(type: string): PayloadRenderer<unknown> | undefined {
  return payloadRenderers.get(type)
}

// resolvePayloadRenderer returns the renderer component registered for the
// payload's `type` field, or undefined when no renderer matches (or when the
// payload isn't a plugin shape). Caller constructs the JSX itself so this
// module stays JSX-free.
export function resolvePayloadRenderer(
  payload: unknown,
): PayloadRenderer<unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const type = (payload as { type?: unknown }).type
  if (typeof type !== 'string') return undefined
  return getPayloadRenderer(type)
}

// isCustomPayload returns true when the payload has a non-'doc' top-level
// type — i.e. it's a plugin payload, not a TipTap document. The reader uses
// this to decide whether to route to a registered renderer or to the default
// TipTap path.
export function isCustomPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const type = (payload as { type?: unknown }).type
  return typeof type === 'string' && type !== 'doc'
}
