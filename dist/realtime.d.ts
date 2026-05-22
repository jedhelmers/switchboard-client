import { type Message } from './client';
type WithSeq = {
    seq: number;
};
export type RealtimeEvent = WithSeq & ({
    type: 'message.created';
    workspace_id: string;
    channel_id: string;
    message_id: string;
    payload: Message;
    emitted_at: string;
} | {
    type: 'message.updated';
    workspace_id: string;
    channel_id: string;
    message_id: string;
    payload: Message;
    emitted_at: string;
} | {
    type: 'message.deleted';
    workspace_id: string;
    channel_id: string;
    message_id: string;
    payload: Message;
    emitted_at: string;
} | {
    type: 'typing.started';
    workspace_id: string;
    channel_id: string;
    user_id: string;
    emitted_at: string;
} | {
    type: 'typing.stopped';
    workspace_id: string;
    channel_id: string;
    user_id: string;
    emitted_at: string;
} | {
    type: 'membership.added';
    workspace_id: string;
    channel_id: string;
    target_user_id: string;
    emitted_at: string;
} | {
    type: 'membership.removed';
    workspace_id: string;
    channel_id: string;
    target_user_id: string;
    emitted_at: string;
} | {
    type: 'jam.started';
    workspace_id: string;
    channel_id: string;
    payload: {
        jam_id: string;
        started_by: string;
        started_at: string;
    };
    emitted_at: string;
} | {
    type: 'jam.ended';
    workspace_id: string;
    channel_id: string;
    payload: {
        jam_id: string;
        ended_at: string;
        duration_seconds: number;
    };
    emitted_at: string;
} | {
    type: 'jam.participant_joined';
    workspace_id: string;
    channel_id: string;
    user_id: string;
    payload: {
        jam_id: string;
        joined_at: string;
    };
    emitted_at: string;
} | {
    type: 'jam.participant_left';
    workspace_id: string;
    channel_id: string;
    user_id: string;
    payload: {
        jam_id: string;
        left_at: string;
    };
    emitted_at: string;
} | {
    type: 'jam.recording_started';
    workspace_id: string;
    channel_id: string;
    payload: {
        recording_id: string;
        jam_id: string;
        started_by: string;
        started_at: string;
    };
    emitted_at: string;
} | {
    type: 'jam.recording_stopped';
    workspace_id: string;
    channel_id: string;
    payload: {
        recording_id: string;
        jam_id: string;
        stopped_at: string;
    };
    emitted_at: string;
} | {
    type: 'jam.recording_ready';
    workspace_id: string;
    channel_id: string;
    payload: {
        recording_id: string;
        jam_id: string;
        transcript_message_id: string;
    };
    emitted_at: string;
} | {
    type: 'jam.recording_failed';
    workspace_id: string;
    channel_id: string;
    payload: {
        recording_id: string;
        jam_id: string;
        reason: string;
    };
    emitted_at: string;
} | {
    type: 'system.resync';
    reason: string;
    emitted_at: string;
});
export type Listener = (ev: RealtimeEvent) => void;
export type ConnectionState = 'connecting' | 'open' | 'closed';
export type URLResolver = string | (() => Promise<string>);
export declare class RealtimeClient {
    private url;
    private ws;
    private listeners;
    private stateListeners;
    private state;
    private retryDelay;
    private readonly maxDelay;
    private stopped;
    private reconnectTimer;
    private lastEventID;
    constructor(url: URLResolver);
    private resolveURL;
    /** Highest server seq this client has observed. Useful for debugging
     *  and for callers that want to persist the position across page reloads. */
    getLastEventID(): number;
    /** Seed the last-event-id from persisted state (e.g., sessionStorage)
     *  before calling start(). After start() the value is managed internally. */
    setLastEventID(seq: number): void;
    start(): void;
    stop(): void;
    on(listener: Listener): () => void;
    onState(listener: (s: ConnectionState) => void): () => void;
    private setState;
    private connect;
}
export declare function realtimeURL(): string;
export declare function realtimeURLProvider(): () => Promise<string>;
export {};
//# sourceMappingURL=realtime.d.ts.map