import { type InfiniteData } from '@tanstack/react-query';
import { type AttachmentFile, type Reaction, type Channel, type DMSummary, type Health, type Invite, type InviteWithToken, type Member, type Mention, type MentionCounts, type MentionNotification, type Message, type OperatorAPIKey, type OperatorAPIKeyWithPlaintext, type OperatorApp, type OperatorAuditEntry, type OperatorChannel, type OperatorDM, type OperatorStats, type OperatorUser, type OperatorWorkspace, type User, type Workspace, type WorkspaceMembership } from './client';
export declare function useMe(): import("@tanstack/react-query").UseQueryResult<User | null, Error>;
export declare function useLogin(): import("@tanstack/react-query").UseMutationResult<User, Error, {
    email: string;
    password: string;
}, unknown>;
export declare function useLogout(): import("@tanstack/react-query").UseMutationResult<{
    status: string;
}, Error, void, unknown>;
export type UpdateMeVars = {
    display_name?: string;
    timezone?: string;
    locale?: string;
    avatar_object_key?: string;
};
export declare function useUpdateMe(): import("@tanstack/react-query").UseMutationResult<User, Error, UpdateMeVars, unknown>;
export declare function uploadAvatar(file: File): Promise<string>;
export declare function useMyWorkspaces(): import("@tanstack/react-query").UseQueryResult<Workspace[], Error>;
export declare function useChannels(slug: string | null): import("@tanstack/react-query").UseQueryResult<Channel[], Error>;
export declare function useMembers(slug: string | null): import("@tanstack/react-query").UseQueryResult<Member[], Error>;
export type UnreadMap = Record<string, number>;
export declare function useUnreadCounts(slug: string | null): import("@tanstack/react-query").UseQueryResult<UnreadMap, Error>;
export declare function useMarkChannelRead(slug: string | null): import("@tanstack/react-query").UseMutationResult<void, Error, string, void>;
export declare function useWorkspaceMentionCounts(slug: string | null): import("@tanstack/react-query").UseQueryResult<MentionCounts, Error>;
export declare function useMyMentions(opts?: {
    unread?: boolean;
    limit?: number;
}): import("@tanstack/react-query").UseQueryResult<{
    mentions: MentionNotification[];
}, Error>;
export declare function useMarkMentionsRead(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    id?: string;
    channelId?: string;
    workspaceId?: string;
}, unknown>;
export declare function setActiveChannel(channelId: string | null): void;
export declare function setCurrentUser(userId: string | null): void;
import { type ConnectionState } from './realtime';
export type MessagesPage = {
    messages: Message[];
    next_cursor?: string;
};
export type MessagesInfiniteData = InfiniteData<MessagesPage, string | undefined>;
export declare function useRealtime(): ConnectionState;
export declare function useMessages(channelId: string | null, realtimeOpen?: boolean, anchorId?: string | null): import("@tanstack/react-query").UseInfiniteQueryResult<MessagesInfiniteData, Error>;
export declare function usePostMessage(channelId: string | null): import("@tanstack/react-query").UseMutationResult<Message, Error, {
    text: string;
    payload?: unknown;
    file_ids?: string[];
    mentions?: Mention[];
}, unknown>;
export declare function useEditMessage(channelId: string | null): import("@tanstack/react-query").UseMutationResult<Message, Error, {
    messageId: string;
    text: string;
    payload?: unknown;
}, unknown>;
export declare function useDeleteMessage(channelId: string | null): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, void>;
export declare function usePinMessage(channelId: string | null): import("@tanstack/react-query").UseMutationResult<unknown, Error, {
    messageId: string;
    pinnedByUserId: string;
}, void>;
export declare function useUnpinMessage(channelId: string | null): import("@tanstack/react-query").UseMutationResult<unknown, Error, {
    messageId: string;
}, void>;
export declare function useChannelPins(channelId: string | null): import("@tanstack/react-query").UseQueryResult<{
    messages: Message[];
}, Error>;
export declare function useToggleReaction(channelId: string | null, currentUserID: string): import("@tanstack/react-query").UseMutationResult<void, Error, {
    messageId: string;
    emoji: string;
    alreadyReacted: boolean;
}, void>;
export type { Reaction };
export type ThreadPage = {
    replies: Message[];
    reply_count: number;
};
export declare function useThreadReplies(rootId: string | null): import("@tanstack/react-query").UseQueryResult<ThreadPage, Error>;
export declare function usePostThreadReply(rootId: string | null, channelId: string | null): import("@tanstack/react-query").UseMutationResult<Message, Error, {
    text: string;
    payload?: unknown;
    file_ids?: string[];
    mentions?: Mention[];
}, unknown>;
export declare function useCreateChannel(slug: string | null): import("@tanstack/react-query").UseMutationResult<Channel, Error, {
    slug: string;
    name?: string;
    kind?: "public" | "private";
    topic?: string;
    description?: string;
}, unknown>;
export declare function usePublicChannels(slug: string | null): import("@tanstack/react-query").UseQueryResult<Channel[], Error>;
export declare function useJoinChannel(slug: string | null): import("@tanstack/react-query").UseMutationResult<Channel, Error, string, unknown>;
export declare function useSearchMessages(slug: string | null, q: string, channelId: string | null): import("@tanstack/react-query").UseQueryResult<Message[], Error>;
export declare function useDMs(slug: string | null): import("@tanstack/react-query").UseQueryResult<DMSummary[], Error>;
export declare function useStartDM(slug: string | null): import("@tanstack/react-query").UseMutationResult<Channel, Error, string, unknown>;
export declare function useTypingState(channelId: string | null, currentUserID: string): string[];
export declare function useTypingNotifier(channelId: string | null): {
    notify: () => void;
    stop: () => void;
};
export declare function useArchiveChannel(slug: string | null): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useDeleteChannel(slug: string | null): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useLeaveChannel(slug: string | null): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function uploadAttachment(workspaceSlug: string, file: File, onProgress?: (frac: number) => void): Promise<AttachmentFile>;
export declare function useWorkspaceInvites(slug: string | null): import("@tanstack/react-query").UseQueryResult<Invite[], Error>;
export declare function useCreateWorkspaceInvite(slug: string | null): import("@tanstack/react-query").UseMutationResult<InviteWithToken, Error, {
    role?: "admin" | "member" | "guest";
    email?: string;
    max_uses?: number;
    expires_in?: string;
}, unknown>;
export declare function useRevokeWorkspaceInvite(slug: string | null): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useAcceptInvite(): import("@tanstack/react-query").UseMutationResult<User, Error, {
    token: string;
    email: string;
    password: string;
    display_name: string;
    timezone?: string;
    locale?: string;
}, unknown>;
export declare function useOperatorStats(): import("@tanstack/react-query").UseQueryResult<OperatorStats, Error>;
export declare function useOperatorWorkspaces(q: string): import("@tanstack/react-query").UseQueryResult<OperatorWorkspace[], Error>;
export declare function useOperatorChannels(q: string, kind: '' | 'public' | 'private'): import("@tanstack/react-query").UseQueryResult<OperatorChannel[], Error>;
export declare function useOperatorDMs(q: string): import("@tanstack/react-query").UseQueryResult<OperatorDM[], Error>;
export declare function useOperatorUsers(q: string): import("@tanstack/react-query").UseQueryResult<OperatorUser[], Error>;
export declare function useOperatorAudit(action: string, actorID: string): import("@tanstack/react-query").UseQueryResult<OperatorAuditEntry[], Error>;
export declare function useOpCreateWorkspace(): import("@tanstack/react-query").UseMutationResult<{
    id: string;
    slug: string;
    name: string;
}, Error, {
    slug: string;
    name: string;
    owner_user_id: string;
    description?: string;
    invite_policy?: string;
}, unknown>;
export declare function useOpSuspendWorkspace(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useOpUnsuspendWorkspace(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useOpDeleteWorkspace(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useOpCreateUser(): import("@tanstack/react-query").UseMutationResult<{
    id: string;
    email: string;
}, Error, {
    email: string;
    display_name: string;
    password: string;
    is_operator?: boolean;
}, unknown>;
export declare function useOpLockUser(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useOpUnlockUser(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useOpForceLogoutUser(): import("@tanstack/react-query").UseMutationResult<{
    revoked: number;
}, Error, string, unknown>;
export declare function useOpDeleteUser(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useOpAddWorkspaceMember(workspaceID: string): import("@tanstack/react-query").UseMutationResult<WorkspaceMembership, Error, {
    user_id: string;
    role?: WorkspaceMembership["role"];
}, unknown>;
export declare function useOpUpdateMemberRole(workspaceID: string): import("@tanstack/react-query").UseMutationResult<WorkspaceMembership, Error, {
    user_id: string;
    role: WorkspaceMembership["role"];
}, unknown>;
export declare function useOpRemoveWorkspaceMember(workspaceID: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
export declare function useHealth(): import("@tanstack/react-query").UseQueryResult<{
    ok: boolean;
    checks: Health;
}, Error>;
export declare function useOperatorApps(): import("@tanstack/react-query").UseQueryResult<OperatorApp[], Error>;
export declare function useOpCreateApp(): import("@tanstack/react-query").UseMutationResult<OperatorApp, Error, {
    slug: string;
    name: string;
    description?: string;
    allowed_origins?: string[];
}, unknown>;
export declare function useOperatorAPIKeys(appId: string | null): import("@tanstack/react-query").UseQueryResult<OperatorAPIKey[], Error>;
export declare function useOpCreateAPIKey(appId: string): import("@tanstack/react-query").UseMutationResult<OperatorAPIKeyWithPlaintext, Error, {
    label: string;
    scopes: string[];
}, unknown>;
export declare function useOpRevokeAPIKey(appId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
//# sourceMappingURL=hooks.d.ts.map