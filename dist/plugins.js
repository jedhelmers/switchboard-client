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
const slashCommands = new Map();
// registerSlashCommand validates + stores a handler. Returns an unsubscribe
// closure so a consumer can clean up in a hot-reload or unmount.
export function registerSlashCommand(cmd) {
    const name = cmd.name.toLowerCase().trim();
    if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) {
        throw new Error(`slash command name must be lowercase alphanumeric (got "${cmd.name}")`);
    }
    slashCommands.set(name, { ...cmd, name });
    return () => {
        // Only unregister if the current entry is still ours — a later
        // re-register shouldn't be wiped by a stale unsubscribe.
        if (slashCommands.get(name) === cmd)
            slashCommands.delete(name);
    };
}
export function getSlashCommand(name) {
    return slashCommands.get(name.toLowerCase());
}
// List registered commands. Returned alphabetically — the typeahead consumer
// is expected to do its own filtering.
export function listSlashCommands() {
    return Array.from(slashCommands.values()).sort((a, b) => a.name.localeCompare(b.name));
}
// parseSlashInput pulls `{name, args}` from a string like "/giphy cat". The
// composer uses this to decide whether to intercept the send. Returns null
// when the input doesn't start with a slash + non-empty word.
export function parseSlashInput(input) {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/'))
        return null;
    const rest = trimmed.slice(1);
    // First whitespace splits name from arguments. A bare "/" or "/   " is not
    // a command — return null so the composer treats it as plain text.
    const match = rest.match(/^([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/);
    if (!match)
        return null;
    return { name: match[1].toLowerCase(), args: match[2]?.trim() ?? '' };
}
const payloadRenderers = new Map();
export function registerPayloadRenderer(type, component) {
    const key = type.trim();
    if (!key)
        throw new Error('payload renderer type must be non-empty');
    payloadRenderers.set(key, component);
    return () => {
        if (payloadRenderers.get(key) === component)
            payloadRenderers.delete(key);
    };
}
export function getPayloadRenderer(type) {
    return payloadRenderers.get(type);
}
// resolvePayloadRenderer returns the renderer component registered for the
// payload's `type` field, or undefined when no renderer matches (or when the
// payload isn't a plugin shape). Caller constructs the JSX itself so this
// module stays JSX-free.
export function resolvePayloadRenderer(payload) {
    if (!payload || typeof payload !== 'object')
        return undefined;
    const type = payload.type;
    if (typeof type !== 'string')
        return undefined;
    return getPayloadRenderer(type);
}
// isCustomPayload returns true when the payload has a non-'doc' top-level
// type — i.e. it's a plugin payload, not a TipTap document. The reader uses
// this to decide whether to route to a registered renderer or to the default
// TipTap path.
export function isCustomPayload(payload) {
    if (!payload || typeof payload !== 'object')
        return false;
    const type = payload.type;
    return typeof type === 'string' && type !== 'doc';
}
//# sourceMappingURL=plugins.js.map