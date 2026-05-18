import { useInfiniteQuery, useMutation, useQuery, useQueryClient, } from '@tanstack/react-query';
import { api, APIError, } from './client';
// ---- auth ------------------------------------------------------------------
export function useMe() {
    return useQuery({
        queryKey: ['me'],
        queryFn: async () => {
            try {
                return await api.get('/v1/me');
            }
            catch (err) {
                if (err instanceof APIError && err.status === 401)
                    return null;
                throw err;
            }
        },
        retry: false,
        staleTime: 60_000,
    });
}
export function useLogin() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post('/v1/auth/login', vars),
        onSuccess: (user) => {
            qc.setQueryData(['me'], user);
        },
    });
}
export function useLogout() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api.post('/v1/auth/logout'),
        onSuccess: () => {
            qc.setQueryData(['me'], null);
            qc.clear();
        },
    });
}
export function useUpdateMe() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.patch('/v1/me', vars),
        onSuccess: (user) => {
            qc.setQueryData(['me'], user);
            // Members lists across every workspace embed the same display_name and
            // avatar — refetch so the chat sidebar + message rows update.
            qc.invalidateQueries({ queryKey: ['members'] });
        },
    });
}
// Self-service password change. Server validates current_password against
// the stored hash before accepting the new one. No cache invalidation —
// the session cookie stays valid.
export function useChangeMyPassword() {
    return useMutation({
        mutationFn: (vars) => api.post('/v1/me/password', vars),
    });
}
// uploadAvatar runs presign → PUT and resolves to the storage object_key the
// caller should send back via useUpdateMe. Two phases on purpose: we don't
// commit the avatar to the user row until the bytes are confirmed in S3.
export async function uploadAvatar(file) {
    const presigned = await api.post('/v1/me/avatar/presign', {
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        bytes: file.size,
    });
    await putWithProgress(presigned.upload_url, file);
    return presigned.object_key;
}
// ---- workspaces / channels --------------------------------------------------
export function useMyWorkspaces() {
    return useQuery({
        queryKey: ['workspaces'],
        queryFn: () => api.get('/v1/workspaces').then((r) => r.workspaces),
    });
}
export function useChannels(slug) {
    return useQuery({
        queryKey: ['channels', slug],
        queryFn: () => api
            .get(`/v1/workspaces/${slug}/channels`)
            .then((r) => r.channels),
        enabled: !!slug,
    });
}
export function useMembers(slug) {
    return useQuery({
        queryKey: ['members', slug],
        queryFn: () => api.get(`/v1/workspaces/${slug}/members`).then((r) => r.members),
        enabled: !!slug,
        staleTime: 30_000,
    });
}
export function useUnreadCounts(slug) {
    return useQuery({
        queryKey: ['unread', slug],
        queryFn: () => api.get(`/v1/workspaces/${slug}/unread`).then((r) => r.unread),
        enabled: !!slug,
        staleTime: 5_000,
    });
}
// useMarkChannelRead is a fire-and-forget POST plus an optimistic local zero
// so the badge clears the instant the user activates the channel. Server is
// the source of truth — its SQL guard only moves last_read_at forward, so
// racing clients can't accidentally re-mark unread.
export function useMarkChannelRead(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (channelId) => api.post(`/v1/channels/${channelId}/read`),
        onMutate: (channelId) => {
            if (!slug)
                return;
            qc.setQueryData(['unread', slug], (prev) => {
                if (!prev)
                    return prev;
                if (!(channelId in prev) || prev[channelId] === 0)
                    return prev;
                return { ...prev, [channelId]: 0 };
            });
            // Server clears mention notifications for this channel as a side
            // effect of mark-read — mirror that locally so the "@N" badge
            // disappears at the same instant the dot does.
            qc.setQueryData(['mention_counts', slug], (prev) => {
                if (!prev)
                    return prev;
                const dropped = prev.by_channel[channelId] ?? 0;
                if (!dropped)
                    return prev;
                return {
                    by_channel: { ...prev.by_channel, [channelId]: 0 },
                    total: Math.max(0, prev.total - dropped),
                };
            });
        },
    });
}
// bumpUnread increments the cached unread count for one channel in every
// workspace cache (we don't know which workspace the channel belongs to from
// the realtime event alone). Called by the realtime patcher on new messages
// the local user is not the author of and is not currently viewing.
function bumpUnread(qc, channelId) {
    qc.getQueriesData({ queryKey: ['unread'], exact: false }).forEach(([key, prev]) => {
        if (!prev)
            return;
        if (!(channelId in prev))
            return;
        qc.setQueryData(key, { ...prev, [channelId]: prev[channelId] + 1 });
    });
}
// ---- mentions --------------------------------------------------------------
// useWorkspaceMentionCounts feeds the per-channel "@N" badges and the bell
// icon's total. Cached short — channel reads, mark-all-read, and incoming
// mentions all invalidate it. We don't poll: the realtime patcher bumps the
// total directly so the badge updates in <100ms without a refetch.
export function useWorkspaceMentionCounts(slug) {
    return useQuery({
        queryKey: ['mention_counts', slug],
        queryFn: () => api.get(`/v1/workspaces/${slug}/mention_counts`),
        enabled: !!slug,
        staleTime: 5_000,
    });
}
// useMyMentions powers the bell-icon panel. `unread` toggles between "show me
// just the unread feed" and "show me recent history including read ones".
export function useMyMentions(opts = {}) {
    const { unread = true, limit = 50 } = opts;
    const params = new URLSearchParams();
    if (unread)
        params.set('unread', 'true');
    if (limit !== 50)
        params.set('limit', String(limit));
    const qs = params.toString();
    return useQuery({
        queryKey: ['mentions', { unread, limit }],
        queryFn: () => api.get(`/v1/me/mentions${qs ? `?${qs}` : ''}`),
    });
}
// useMarkMentionsRead handles all three flavors of mark-read: by id, by
// channel, or workspace-wide. Server picks the right query based on which
// fields are set. Cache invalidation is broad-strokes — feeds + counts both
// reload so we don't have to keep the local state perfectly in sync.
export function useMarkMentionsRead() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post('/v1/me/mentions/read', {
            id: vars.id,
            channel_id: vars.channelId,
            workspace_id: vars.workspaceId,
        }),
        onSuccess: (_d, vars) => {
            qc.invalidateQueries({ queryKey: ['mentions'] });
            qc.invalidateQueries({ queryKey: ['mention_counts'] });
            // If we cleared a single channel, optimistically zero its bucket so
            // the UI snaps before the refetch lands.
            if (vars.channelId) {
                qc.getQueriesData({ queryKey: ['mention_counts'], exact: false }).forEach(([key, prev]) => {
                    if (!prev)
                        return;
                    const dropped = prev.by_channel[vars.channelId] ?? 0;
                    if (!dropped)
                        return;
                    const next = {
                        by_channel: { ...prev.by_channel, [vars.channelId]: 0 },
                        total: Math.max(0, prev.total - dropped),
                    };
                    qc.setQueryData(key, next);
                });
            }
        },
    });
}
// bumpMentionCount surgically increments the per-channel + total counts in
// the cache without a refetch. Mirrors bumpUnread; called by the realtime
// patcher when an incoming message mentions us.
function bumpMentionCount(qc, workspaceId, channelId) {
    qc.getQueriesData({ queryKey: ['mention_counts'], exact: false }).forEach(([key, prev]) => {
        if (!prev)
            return;
        // workspaceId may not match this cache's slug — but mention_counts is
        // keyed by slug, not id. Without a slug→id map handy, we just bump
        // every cached workspace and let the next refetch reconcile. Cheap
        // (the badge only renders the current workspace anyway).
        void workspaceId;
        const cur = prev.by_channel[channelId] ?? 0;
        qc.setQueryData(key, {
            by_channel: { ...prev.by_channel, [channelId]: cur + 1 },
            total: prev.total + 1,
        });
    });
}
// Active channel signal — components write the currently-viewed channel id so
// the realtime patcher knows not to bump unread for it. A bare module ref is
// fine: there's only one chat surface at a time and React owns the lifecycle.
const activeChannelRef = { current: null };
export function setActiveChannel(channelId) {
    activeChannelRef.current = channelId;
}
// Local user id, set by the Chat shell so the realtime patcher can skip
// bumping unread on the user's own messages.
const currentUserRef = { current: null };
export function setCurrentUser(userId) {
    currentUserRef.current = userId;
}
// ---- messages --------------------------------------------------------------
// ---- realtime: shared client + cache integration --------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { RealtimeClient, realtimeURLProvider } from './realtime';
let sharedClient = null;
function applyRealtimeEvent(qc, ev) {
    // useMessages keys queries by ['messages', channelId, anchorId ?? ''] so
    // changing the anchor (e.g. from a search-result jump) gets a fresh fetch.
    // Realtime patches need to update EVERY cached variant for the channel —
    // both the no-anchor "live" view and any anchor-scoped views the user
    // happens to have visited. setQueriesData with a prefix-only key + exact:false
    // matches all of them.
    const filter = { queryKey: ['messages', ev.channel_id], exact: false };
    switch (ev.type) {
        case 'message.created': {
            const rootId = ev.payload.thread_root_id;
            if (rootId) {
                // Thread reply — never goes into the channel timeline. Append to
                // the thread cache if it's loaded (don't create one from a single
                // reply — we'd be storing a partial page). The parent's reply_count
                // is updated via bumpReplyCount, which is id-deduped against the
                // local mutation's onSuccess so the sender never double-counts.
                qc.setQueryData(['thread', rootId], (prev) => {
                    if (!prev)
                        return prev;
                    if (prev.replies.some((m) => m.id === ev.message_id))
                        return prev;
                    return {
                        replies: [...prev.replies, ev.payload],
                        reply_count: prev.reply_count + 1,
                    };
                });
                bumpReplyCount(qc, ev.channel_id, rootId, ev.message_id, ev.payload.created_at);
                break;
            }
            qc.setQueriesData(filter, (prev) => {
                if (!prev || prev.pages.length === 0)
                    return prev;
                // De-dup across all pages (the poster gets the optimistic POST result first).
                if (prev.pages.some((p) => p.messages.some((m) => m.id === ev.message_id))) {
                    return prev;
                }
                // New message lands on the first page (newest first).
                const first = prev.pages[0];
                const rest = prev.pages.slice(1);
                return {
                    ...prev,
                    pages: [{ ...first, messages: [ev.payload, ...first.messages] }, ...rest],
                };
            });
            // Refresh DM lists across all workspaces — a previously-empty DM may
            // now have its first message and need to appear in the recipient's
            // sidebar. Cheap: only active queries refetch.
            qc.invalidateQueries({ queryKey: ['dms'] });
            // Bump the unread badge if this message lands in a channel the user
            // isn't currently viewing AND wasn't sent by them. The active channel
            // ref + current user ref are written by the Chat shell.
            const authoredByMe = currentUserRef.current != null &&
                ev.payload.user_id === currentUserRef.current;
            if (!authoredByMe && activeChannelRef.current !== ev.channel_id) {
                bumpUnread(qc, ev.channel_id);
            }
            // Mention badge bump. Only fire when (a) the message mentions me
            // (user kind with my id, or any channel-wide kind), (b) I'm not the
            // author, and (c) I'm not currently viewing the channel — opening
            // the channel already clears mentions server-side.
            if (!authoredByMe &&
                activeChannelRef.current !== ev.channel_id &&
                currentUserRef.current) {
                const mentions = ev.payload.mentions ?? [];
                const me = currentUserRef.current;
                const mentionsMe = mentions.some((m) => m.kind === 'user' ? m.user_id === me : true);
                if (mentionsMe) {
                    bumpMentionCount(qc, ev.workspace_id, ev.channel_id);
                    // Also invalidate the /me/mentions feed so an open bell panel
                    // picks up the new entry. Server-of-record is the table, not
                    // our cache extrapolation.
                    qc.invalidateQueries({ queryKey: ['mentions'] });
                }
            }
            break;
        }
        case 'message.updated': {
            // Track whether this update flips the pinned flag — if so we'll
            // invalidate the pins query for the channel below so an open Pinned
            // panel reflects the change without a manual refresh.
            let pinnedFlipped = false;
            // Merge rather than replace. The server's edit handler doesn't
            // populate reply_count / last_reply_at on the broadcast payload (those
            // come from a separate bulk loader), so a hard replace would wipe
            // those fields from the cache and the thread badge would vanish on
            // every edit. Spread-merge preserves everything the new payload
            // doesn't carry.
            qc.setQueriesData(filter, (prev) => {
                if (!prev)
                    return prev;
                return {
                    ...prev,
                    pages: prev.pages.map((p) => ({
                        ...p,
                        messages: p.messages.map((m) => {
                            if (m.id !== ev.message_id)
                                return m;
                            if (ev.payload.pinned !== undefined &&
                                !!m.pinned !== !!ev.payload.pinned) {
                                pinnedFlipped = true;
                            }
                            return { ...m, ...ev.payload };
                        }),
                    })),
                };
            });
            // Edits to a reply also need to flow into the open thread cache.
            const updRoot = ev.payload.thread_root_id;
            if (updRoot) {
                qc.setQueryData(['thread', updRoot], (prev) => {
                    if (!prev)
                        return prev;
                    return {
                        ...prev,
                        replies: prev.replies.map((m) => m.id === ev.message_id ? { ...m, ...ev.payload } : m),
                    };
                });
            }
            if (pinnedFlipped) {
                qc.invalidateQueries({ queryKey: ['pins', ev.channel_id] });
            }
            break;
        }
        case 'message.deleted': {
            qc.setQueriesData(filter, (prev) => {
                if (!prev)
                    return prev;
                return {
                    ...prev,
                    pages: prev.pages.map((p) => ({
                        ...p,
                        messages: p.messages.filter((m) => m.id !== ev.message_id),
                    })),
                };
            });
            // If the deleted message was a thread reply, prune it from the open
            // thread + decrement the parent's reply_count. We don't know rootId
            // from the event itself, so walk every cached thread.
            qc.getQueriesData({ queryKey: ['thread'], exact: false }).forEach(([key, prev]) => {
                if (!prev)
                    return;
                const found = prev.replies.find((m) => m.id === ev.message_id);
                if (!found)
                    return;
                qc.setQueryData(key, {
                    replies: prev.replies.filter((m) => m.id !== ev.message_id),
                    reply_count: Math.max(0, prev.reply_count - 1),
                });
                const rootId = key[1];
                if (rootId) {
                    patchMessage(qc, ev.channel_id, rootId, (m) => ({
                        ...m,
                        reply_count: Math.max(0, (m.reply_count ?? 1) - 1),
                    }));
                }
            });
            break;
        }
        case 'membership.added':
        case 'membership.removed': {
            // The server fires these to the affected user only (filtered at the
            // hub) when they join/leave/are added/removed from a channel — direct,
            // DM, or otherwise. We don't know which workspace's `channels` /
            // `dms` cache to patch surgically, so invalidate broadly. Both queries
            // are short-lived and only refetch when there's an active subscriber.
            qc.invalidateQueries({ queryKey: ['channels'] });
            qc.invalidateQueries({ queryKey: ['dms'] });
            if (ev.type === 'membership.removed') {
                // Drop the now-inaccessible channel's cached message pages too so
                // navigating back to it doesn't show stale content from before the
                // removal. Mention counts for the channel are also stale.
                qc.removeQueries({ queryKey: ['messages', ev.channel_id], exact: false });
                qc.invalidateQueries({ queryKey: ['unread'] });
                qc.invalidateQueries({ queryKey: ['mention_counts'] });
            }
            break;
        }
    }
}
// useRealtime maintains a single WS connection for the lifetime of the auth'd
// session. Exposes the connection state so consumers (eg. useMessages) can
// disable polling when push is live.
export function useRealtime() {
    const qc = useQueryClient();
    const [state, setState] = useState('closed');
    useEffect(() => {
        if (!sharedClient) {
            sharedClient = new RealtimeClient(realtimeURLProvider());
        }
        const c = sharedClient;
        const offState = c.onState(setState);
        const offEvent = c.on((ev) => applyRealtimeEvent(qc, ev));
        c.start();
        return () => {
            offState();
            offEvent();
            // Note: we don't stop the client on unmount; it lives across remounts.
        };
    }, [qc]);
    return state;
}
// useMessages: cursor-paginated infinite query over a channel's messages.
// Pages are returned newest-first; fetchNextPage loads OLDER messages
// (the API cursor walks backward in time). Realtime push updates the first page
// in place; falls back to polling the first page when the WS is closed.
//
// anchorId (optional): when set, the FIRST page is fetched with ?anchor=<id>
// returning a window centered on that message. Used by "scroll to message"
// from search results. After the anchor fetch, fetchNextPage walks normally
// backward from the oldest message in the window. Anchor is part of the
// query key so changing it forces a fresh first fetch.
export function useMessages(channelId, realtimeOpen = false, anchorId = null) {
    return useInfiniteQuery({
        queryKey: ['messages', channelId, anchorId ?? ''],
        queryFn: ({ pageParam }) => {
            const params = new URLSearchParams();
            if (pageParam)
                params.set('cursor', pageParam);
            else if (anchorId)
                params.set('anchor', anchorId);
            const qs = params.toString();
            return api.get(`/v1/channels/${channelId}/messages${qs ? `?${qs}` : ''}`);
        },
        initialPageParam: undefined,
        getNextPageParam: (lastPage) => lastPage.next_cursor,
        enabled: !!channelId,
        refetchInterval: realtimeOpen ? false : 2000,
        refetchIntervalInBackground: false,
    });
}
export function usePostMessage(channelId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post(`/v1/channels/${channelId}/messages`, vars),
        onSuccess: (msg) => {
            // Optimistic insert into page 0 so the message shows immediately, even
            // before the WS event lands. Realtime patcher de-dups by id, and we avoid
            // invalidate so older pages (loaded by scroll) don't refetch and yank
            // the viewport.
            qc.setQueriesData({ queryKey: ['messages', channelId], exact: false }, (prev) => {
                if (!prev || prev.pages.length === 0)
                    return prev;
                if (prev.pages.some((p) => p.messages.some((m) => m.id === msg.id))) {
                    return prev;
                }
                const first = prev.pages[0];
                const rest = prev.pages.slice(1);
                return {
                    ...prev,
                    pages: [{ ...first, messages: [msg, ...first.messages] }, ...rest],
                };
            });
        },
    });
}
// ---- message edit / delete / reactions -------------------------------------
// Helper: patch one message in every cached variant for a channel (live view
// + any anchor-scoped views, since useMessages keys queries by anchorId too).
function patchMessage(qc, channelId, messageId, fn) {
    qc.setQueriesData({ queryKey: ['messages', channelId], exact: false }, (prev) => {
        if (!prev)
            return prev;
        return {
            ...prev,
            pages: prev.pages.map((p) => ({
                ...p,
                messages: p.messages.map((m) => (m.id === messageId ? fn(m) : m)),
            })),
        };
    });
}
// Helper: drop one message from every cached variant for a channel.
function dropMessage(qc, channelId, messageId) {
    qc.setQueriesData({ queryKey: ['messages', channelId], exact: false }, (prev) => {
        if (!prev)
            return prev;
        return {
            ...prev,
            pages: prev.pages.map((p) => ({
                ...p,
                messages: p.messages.filter((m) => m.id !== messageId),
            })),
        };
    });
}
export function useEditMessage(channelId) {
    return useMutation({
        mutationFn: (vars) => api.patch(`/v1/messages/${vars.messageId}`, {
            text: vars.text,
            payload: vars.payload,
        }),
        // No optimistic update: server returns the canonical edited message and
        // realtime patcher will push it to other clients. We refresh ours via
        // the mutation result here.
    });
}
export function useDeleteMessage(channelId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (messageId) => api.del(`/v1/messages/${messageId}`),
        onMutate: (messageId) => {
            if (!channelId)
                return;
            // Optimistic drop. Realtime message.deleted will arrive shortly and
            // de-dups via the same filter.
            dropMessage(qc, channelId, messageId);
        },
    });
}
// ---- pins ------------------------------------------------------------------
// usePinMessage / useUnpinMessage hit POST/DELETE /v1/messages/{id}/pin. Both
// are idempotent server-side, so re-firing them is safe. We patch the cache
// optimistically — the realtime message.updated echo will spread-merge the
// canonical pin metadata in shortly after, which is order-independent with
// our local patch (pinned is just a flag, no count to dedup).
export function usePinMessage(channelId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post(`/v1/messages/${vars.messageId}/pin`, {}),
        onMutate: ({ messageId, pinnedByUserId }) => {
            if (!channelId)
                return;
            const nowISO = new Date().toISOString();
            patchMessage(qc, channelId, messageId, (m) => ({
                ...m,
                pinned: true,
                pinned_by_user_id: pinnedByUserId,
                pinned_at: nowISO,
            }));
        },
        onSuccess: (_data, vars) => {
            if (channelId)
                bumpPinsCache(qc, channelId);
            // Patch the open thread too if this message lives there.
            patchThreadMessage(qc, vars.messageId, (m) => ({
                ...m,
                pinned: true,
                pinned_by_user_id: vars.pinnedByUserId,
                pinned_at: new Date().toISOString(),
            }));
        },
    });
}
export function useUnpinMessage(channelId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.del(`/v1/messages/${vars.messageId}/pin`),
        onMutate: ({ messageId }) => {
            if (!channelId)
                return;
            patchMessage(qc, channelId, messageId, (m) => ({
                ...m,
                pinned: false,
                pinned_by_user_id: undefined,
                pinned_at: undefined,
            }));
        },
        onSuccess: (_data, vars) => {
            if (channelId)
                bumpPinsCache(qc, channelId);
            patchThreadMessage(qc, vars.messageId, (m) => ({
                ...m,
                pinned: false,
                pinned_by_user_id: undefined,
                pinned_at: undefined,
            }));
        },
    });
}
// useChannelPins fetches the pinned-messages list for a channel. The server
// returns full Message objects (same shape as the timeline), newest-pinned
// first. Pin/unpin mutations invalidate this cache via bumpPinsCache so the
// sidebar panel stays fresh without manual refetch from consumers.
export function useChannelPins(channelId) {
    return useQuery({
        queryKey: ['pins', channelId],
        enabled: !!channelId,
        queryFn: () => api.get(`/v1/channels/${channelId}/pins`),
    });
}
function bumpPinsCache(qc, channelId) {
    qc.invalidateQueries({ queryKey: ['pins', channelId] });
}
// patchThreadMessage updates a single message inside any cached thread page —
// pins on thread replies need to reflect in the open thread view too, not just
// the channel timeline.
function patchThreadMessage(qc, messageId, fn) {
    qc.getQueriesData({ queryKey: ['thread'], exact: false }).forEach(([key, prev]) => {
        if (!prev)
            return;
        const i = prev.replies.findIndex((m) => m.id === messageId);
        if (i === -1)
            return;
        const next = prev.replies.slice();
        next[i] = fn(prev.replies[i]);
        qc.setQueryData(key, { ...prev, replies: next });
    });
}
export function useToggleReaction(channelId, currentUserID) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (vars) => {
            if (vars.alreadyReacted) {
                await api.del(`/v1/messages/${vars.messageId}/reactions/${encodeURIComponent(vars.emoji)}`);
            }
            else {
                await api.post(`/v1/messages/${vars.messageId}/reactions`, { emoji: vars.emoji });
            }
        },
        onMutate: ({ messageId, emoji, alreadyReacted }) => {
            if (!channelId)
                return;
            // Optimistically toggle the reaction in cache so the UI snaps without
            // waiting for server + realtime round-trip.
            patchMessage(qc, channelId, messageId, (m) => {
                const next = (m.reactions ?? []).slice();
                const idx = next.findIndex((r) => r.emoji === emoji);
                if (alreadyReacted) {
                    if (idx === -1)
                        return m;
                    const r = next[idx];
                    const users = r.user_ids.filter((u) => u !== currentUserID);
                    if (users.length === 0)
                        next.splice(idx, 1);
                    else
                        next[idx] = { ...r, count: users.length, user_ids: users };
                }
                else {
                    if (idx === -1) {
                        next.push({ emoji, count: 1, user_ids: [currentUserID] });
                    }
                    else {
                        const r = next[idx];
                        if (r.user_ids.includes(currentUserID))
                            return m;
                        next[idx] = { ...r, count: r.count + 1, user_ids: [...r.user_ids, currentUserID] };
                    }
                }
                return { ...m, reactions: next };
            });
        },
    });
}
// useThreadReplies fetches all replies for a thread root. Slack-style threads
// are 1-deep so a flat list is the whole conversation. We use a plain useQuery
// (not infinite) because thread depths are bounded in practice.
export function useThreadReplies(rootId) {
    return useQuery({
        queryKey: ['thread', rootId],
        enabled: !!rootId,
        queryFn: () => api.get(`/v1/messages/${rootId}/replies`),
    });
}
// usePostThreadReply posts to a thread and patches both the thread cache and
// the parent message's reply_count in the channel timeline. The realtime
// patcher applies the same logic when other clients send replies.
export function usePostThreadReply(rootId, channelId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post(`/v1/messages/${rootId}/replies`, vars),
        onSuccess: (reply) => {
            if (rootId) {
                qc.setQueryData(['thread', rootId], (prev) => {
                    if (!prev)
                        return { replies: [reply], reply_count: 1 };
                    // De-dup in case realtime got here first.
                    if (prev.replies.some((m) => m.id === reply.id))
                        return prev;
                    return { replies: [...prev.replies, reply], reply_count: prev.reply_count + 1 };
                });
            }
            if (channelId && rootId) {
                bumpReplyCount(qc, channelId, rootId, reply.id, reply.created_at);
            }
        },
    });
}
// bumpedReplyIds dedups parent reply_count increments by reply id. Both the
// local mutation (usePostThreadReply.onSuccess) and the realtime patcher try
// to bump for the same reply — without dedup the sender would double-count
// because the server publishes the realtime event before the HTTP response
// returns, so the two paths can race in either order. The id-based check
// here is order-independent: whichever fires first applies the +1, the
// second is a no-op. FIFO-evicts after 5000 entries so memory stays bounded.
const bumpedReplyIds = new Set();
const bumpedReplyOrder = [];
const BUMP_DEDUP_CAP = 5000;
function rememberBump(replyId) {
    if (bumpedReplyIds.has(replyId))
        return false;
    bumpedReplyIds.add(replyId);
    bumpedReplyOrder.push(replyId);
    if (bumpedReplyOrder.length > BUMP_DEDUP_CAP) {
        const evict = bumpedReplyOrder.shift();
        if (evict)
            bumpedReplyIds.delete(evict);
    }
    return true;
}
// bumpReplyCount adds 1 to the parent's reply_count and updates last_reply_at
// in every cached variant of the channel's messages list. Idempotent per
// replyId — call from both usePostThreadReply and applyRealtimeEvent.
function bumpReplyCount(qc, channelId, rootId, replyId, lastReplyAt) {
    if (!rememberBump(replyId))
        return;
    patchMessage(qc, channelId, rootId, (m) => ({
        ...m,
        reply_count: (m.reply_count ?? 0) + 1,
        last_reply_at: lastReplyAt,
    }));
}
// ---- channels: create / browse / join --------------------------------------
export function useCreateChannel(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post(`/v1/workspaces/${slug}/channels`, vars),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['channels', slug] });
        },
    });
}
export function usePublicChannels(slug) {
    return useQuery({
        queryKey: ['public-channels', slug],
        queryFn: () => api
            .get(`/v1/workspaces/${slug}/channels/public`)
            .then((r) => r.channels),
        enabled: !!slug,
        staleTime: 5_000,
    });
}
export function useJoinChannel(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (channelId) => api.post(`/v1/channels/${channelId}/join`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['channels', slug] });
            qc.invalidateQueries({ queryKey: ['public-channels', slug] });
        },
    });
}
// ---- search ----------------------------------------------------------------
// useSearchMessages runs full-text search against the workspace, optionally
// scoped to a single channel. Empty queries short-circuit to no request.
// Debouncing happens in the consumer via debouncing the `q` value passed in.
export function useSearchMessages(slug, q, channelId) {
    return useQuery({
        queryKey: ['search', slug, q, channelId ?? ''],
        queryFn: () => {
            const params = new URLSearchParams();
            params.set('q', q);
            if (channelId)
                params.set('channel_id', channelId);
            return api
                .get(`/v1/workspaces/${slug}/search?${params.toString()}`)
                .then((r) => r.messages);
        },
        enabled: !!slug && q.trim().length > 0,
        staleTime: 5_000,
    });
}
// ---- DMs -------------------------------------------------------------------
export function useDMs(slug) {
    return useQuery({
        queryKey: ['dms', slug],
        queryFn: () => api.get(`/v1/workspaces/${slug}/dms`).then((r) => r.dms),
        enabled: !!slug,
    });
}
// useStartDM is find-or-create. Returns the channel; the server returns the
// same channel for repeat calls with the same target user_id.
export function useStartDM(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userID) => api.post(`/v1/workspaces/${slug}/dms`, { user_id: userID }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['dms', slug] });
        },
    });
}
// ---- typing indicators ----------------------------------------------------
// TYPING_TTL_MS: how long a typing entry stays live without a refresh event.
// Slightly longer than the client's notify cadence (3s) so a single dropped
// realtime packet doesn't blink the indicator off.
const TYPING_TTL_MS = 5000;
// useTypingState subscribes to the shared realtime client and returns the set
// of *other* users currently typing in the given channel. The set re-renders
// when entries change and when their TTLs expire.
export function useTypingState(channelId, currentUserID) {
    const [version, setVersion] = useState(0);
    // Map<channel_id, Map<user_id, expires_at_ms>> kept in a ref so we don't
    // re-render the world on every keystroke event.
    const stateRef = useRef(new Map());
    useEffect(() => {
        if (!sharedClient) {
            sharedClient = new RealtimeClient(realtimeURLProvider());
        }
        const c = sharedClient;
        const off = c.on((ev) => {
            if (ev.type !== 'typing.started' && ev.type !== 'typing.stopped')
                return;
            if (ev.user_id === currentUserID)
                return; // never show ourselves
            const channelMap = stateRef.current.get(ev.channel_id) ??
                stateRef.current.set(ev.channel_id, new Map()).get(ev.channel_id);
            if (ev.type === 'typing.started') {
                channelMap.set(ev.user_id, Date.now() + TYPING_TTL_MS);
            }
            else {
                channelMap.delete(ev.user_id);
            }
            setVersion((v) => v + 1);
        });
        // Sweep expired entries every 1s.
        const sweep = window.setInterval(() => {
            const now = Date.now();
            let changed = false;
            stateRef.current.forEach((channelMap) => {
                channelMap.forEach((expiresAt, userId) => {
                    if (expiresAt <= now) {
                        channelMap.delete(userId);
                        changed = true;
                    }
                });
            });
            if (changed)
                setVersion((v) => v + 1);
        }, 1000);
        c.start();
        return () => {
            off();
            window.clearInterval(sweep);
        };
    }, [currentUserID]);
    if (!channelId) {
        void version; // keep the lint happy
        return [];
    }
    const channelMap = stateRef.current.get(channelId);
    if (!channelMap || channelMap.size === 0) {
        void version;
        return [];
    }
    // Snapshot live (non-expired) user ids.
    const now = Date.now();
    const out = [];
    channelMap.forEach((expiresAt, userId) => {
        if (expiresAt > now)
            out.push(userId);
    });
    return out;
}
// TYPING_NOTIFY_INTERVAL_MS: cadence for re-sending typing.started while the
// user is actively typing. Keep below TYPING_TTL_MS or the indicator will
// blink off mid-typing. 3s is the conventional balance.
const TYPING_NOTIFY_INTERVAL_MS = 3000;
// useTypingNotifier returns two functions for the composer:
//   notify() — call on every keystroke. Throttles to one POST per 3s.
//   stop()   — call on send / blur / unmount to snap the indicator off
//              for receivers without waiting for their TTL to expire.
// No-op when channelId is null (eg. between channels).
export function useTypingNotifier(channelId) {
    const lastSentRef = useRef(0);
    const isTypingRef = useRef(false);
    const stop = useCallback(() => {
        if (!channelId || !isTypingRef.current)
            return;
        isTypingRef.current = false;
        lastSentRef.current = 0;
        // Best-effort: don't await, don't surface errors. The receiver's TTL is
        // the safety net.
        void api.del(`/v1/channels/${channelId}/typing`).catch(() => { });
    }, [channelId]);
    const notify = useCallback(() => {
        if (!channelId)
            return;
        const now = Date.now();
        if (now - lastSentRef.current < TYPING_NOTIFY_INTERVAL_MS)
            return;
        lastSentRef.current = now;
        isTypingRef.current = true;
        void api.post(`/v1/channels/${channelId}/typing`).catch(() => { });
    }, [channelId]);
    // If the channel changes mid-flight, send a stop for the previous one.
    useEffect(() => {
        return () => {
            stop();
        };
    }, [stop]);
    return { notify, stop };
}
// useArchiveChannel hides a channel for everyone in the workspace.
// Workspace-admin gated server-side; the UI also gates the affordance.
export function useArchiveChannel(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (channelId) => api.post(`/v1/channels/${channelId}/archive`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['channels', slug] });
            qc.invalidateQueries({ queryKey: ['public-channels', slug] });
        },
    });
}
// useDeleteChannel soft-deletes a channel (sets deleted_at). Permanent from
// the UI's perspective; row stays in the DB for audit / future hard-purge.
export function useDeleteChannel(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (channelId) => api.del(`/v1/channels/${channelId}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['channels', slug] });
            qc.invalidateQueries({ queryKey: ['public-channels', slug] });
        },
    });
}
// useLeaveChannel soft-removes the caller from a channel by setting
// channel_memberships.left_at. For DMs this is the "delete chat" action —
// the conversation reopens for the caller automatically if the other
// participant posts a new message. For named channels it's "leave channel."
export function useLeaveChannel(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (channelId) => api.post(`/v1/channels/${channelId}/leave`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['channels', slug] });
            qc.invalidateQueries({ queryKey: ['dms', slug] });
        },
    });
}
// ---- attachments ----------------------------------------------------------
// uploadAttachment runs the full presign → PUT → finalize dance for a single
// file. Returns the finalized file metadata (incl. id, ready for attaching to
// a message). onProgress fires 0..1 during the PUT phase.
export async function uploadAttachment(workspaceSlug, file, onProgress) {
    // 1. Reserve a row + get a presigned PUT URL.
    const presigned = await api.post(`/v1/workspaces/${workspaceSlug}/uploads/presign`, {
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        bytes: file.size,
    });
    // 2. PUT directly to MinIO/S3. We use XHR for progress events; fetch can't.
    await putWithProgress(presigned.upload_url, file, onProgress);
    // 3. Tell the server to mark the row ready. Pass image dimensions if known.
    let imageWidth;
    let imageHeight;
    if (file.type.startsWith('image/')) {
        try {
            const dim = await readImageDimensions(file);
            imageWidth = dim.width;
            imageHeight = dim.height;
        }
        catch {
            // Non-fatal — server still finalizes without dims.
        }
    }
    return api.post(`/v1/files/${presigned.file_id}/finalize`, {
        image_width: imageWidth,
        image_height: imageHeight,
    });
}
function putWithProgress(url, file, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
            if (onProgress && e.lengthComputable) {
                onProgress(e.loaded / e.total);
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300)
                resolve();
            else
                reject(new Error(`PUT failed: ${xhr.status} ${xhr.statusText}`));
        };
        xhr.onerror = () => reject(new Error('PUT network error'));
        xhr.send(file);
    });
}
function readImageDimensions(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            URL.revokeObjectURL(url);
            resolve({ width: w, height: h });
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}
// ---- workspace invites (admin/owner only) ----------------------------------
export function useWorkspaceInvites(slug) {
    return useQuery({
        queryKey: ['invites', slug],
        queryFn: () => api
            .get(`/v1/workspaces/${slug}/invites`)
            .then((r) => r.invites),
        enabled: !!slug,
    });
}
export function useCreateWorkspaceInvite(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post(`/v1/workspaces/${slug}/invites`, vars),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invites', slug] });
        },
    });
}
export function useRevokeWorkspaceInvite(slug) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.del(`/v1/workspaces/${slug}/invites/${id}`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invites', slug] });
        },
    });
}
// ---- invite acceptance (no auth — public route) ---------------------------
export function useAcceptInvite() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post('/v1/invites/accept', vars),
        onSuccess: (user) => {
            qc.setQueryData(['me'], user);
        },
    });
}
// ---- operator dashboard ----------------------------------------------------
export function useOperatorStats() {
    return useQuery({
        queryKey: ['op', 'stats'],
        queryFn: () => api.get('/v1/operator/stats'),
        refetchInterval: 5_000,
    });
}
export function useOperatorWorkspaces(q) {
    return useQuery({
        queryKey: ['op', 'workspaces', q],
        queryFn: () => api
            .get(`/v1/operator/workspaces?q=${encodeURIComponent(q)}`)
            .then((r) => r.workspaces),
        staleTime: 2_000,
    });
}
export function useOperatorChannels(q, kind) {
    return useQuery({
        queryKey: ['op', 'channels', q, kind],
        queryFn: () => api
            .get(`/v1/operator/channels?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`)
            .then((r) => r.channels),
        staleTime: 2_000,
    });
}
export function useOperatorDMs(q) {
    return useQuery({
        queryKey: ['op', 'dms', q],
        queryFn: () => api
            .get(`/v1/operator/dms?q=${encodeURIComponent(q)}`)
            .then((r) => r.dms),
        staleTime: 2_000,
    });
}
export function useOperatorUsers(q) {
    return useQuery({
        queryKey: ['op', 'users', q],
        queryFn: () => api
            .get(`/v1/operator/users?q=${encodeURIComponent(q)}`)
            .then((r) => r.users),
        staleTime: 2_000,
    });
}
export function useOperatorAudit(action, actorID) {
    return useQuery({
        queryKey: ['op', 'audit', action, actorID],
        queryFn: () => {
            const params = new URLSearchParams();
            if (action)
                params.set('action', action);
            if (actorID)
                params.set('actor_id', actorID);
            const qs = params.toString();
            return api
                .get('/v1/operator/audit' + (qs ? `?${qs}` : ''))
                .then((r) => r.entries);
        },
        staleTime: 2_000,
    });
}
// ---- operator mutations ---------------------------------------------------
function invalidateOperator(qc) {
    qc.invalidateQueries({ queryKey: ['op'] });
}
export function useOpCreateWorkspace() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post('/v1/operator/workspaces', vars),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpSuspendWorkspace() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.post(`/v1/operator/workspaces/${id}/suspend`),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpUnsuspendWorkspace() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.post(`/v1/operator/workspaces/${id}/unsuspend`),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpDeleteWorkspace() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.del(`/v1/operator/workspaces/${id}`),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpCreateUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post('/v1/operator/users', vars),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpLockUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.post(`/v1/operator/users/${id}/lock`),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpUnlockUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.post(`/v1/operator/users/${id}/unlock`),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpForceLogoutUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.post(`/v1/operator/users/${id}/force-logout`),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpDeleteUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api.del(`/v1/operator/users/${id}`),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpUpdateUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => {
            const { id, ...body } = vars;
            return api.patch(`/v1/operator/users/${id}`, body);
        },
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpResetUserPassword() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post(`/v1/operator/users/${vars.id}/password`, {
            new_password: vars.new_password,
        }),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpAddWorkspaceMember(workspaceID) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post(`/v1/operator/workspaces/${workspaceID}/members`, vars),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpUpdateMemberRole(workspaceID) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.patch(`/v1/operator/workspaces/${workspaceID}/members/${vars.user_id}`, { role: vars.role }),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useOpRemoveWorkspaceMember(workspaceID) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userID) => api.del(`/v1/operator/workspaces/${workspaceID}/members/${userID}`),
        onSuccess: () => invalidateOperator(qc),
    });
}
export function useHealth() {
    return useQuery({
        queryKey: ['health'],
        queryFn: async () => {
            // /readyz can return 503; treat that as data, not error.
            const res = await fetch('/api/readyz', { credentials: 'include' });
            const body = (await res.json());
            return { ok: res.ok, checks: body };
        },
        refetchInterval: 5_000,
    });
}
// ---- operator: parent apps + api keys --------------------------------------
export function useOperatorApps() {
    return useQuery({
        queryKey: ['op', 'apps'],
        queryFn: () => api.get('/v1/operator/apps'),
        staleTime: 2_000,
    });
}
export function useOpCreateApp() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post('/v1/operator/apps', vars),
        onSuccess: () => invalidateOperator(qc),
    });
}
// Keys are scoped to an app — the query key carries the app id so two apps
// can be open in different tabs without their key lists stomping each other.
export function useOperatorAPIKeys(appId) {
    return useQuery({
        queryKey: ['op', 'apps', appId, 'keys'],
        queryFn: () => api.get(`/v1/operator/apps/${appId}/api-keys`),
        enabled: !!appId,
        staleTime: 2_000,
    });
}
// Returns the plaintext as part of the response — the UI must surface it
// once and then discard. There is no read endpoint that returns plaintext.
export function useOpCreateAPIKey(appId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (vars) => api.post(`/v1/operator/apps/${appId}/api-keys`, vars),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['op', 'apps', appId, 'keys'] }),
    });
}
export function useOpRevokeAPIKey(appId) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (keyId) => api.del(`/v1/operator/api-keys/${keyId}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['op', 'apps', appId, 'keys'] }),
    });
}
//# sourceMappingURL=hooks.js.map