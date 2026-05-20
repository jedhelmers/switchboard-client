import { type Message } from './client';
export type RealtimeEvent = {
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
    type: 'huddle.started';
    workspace_id: string;
    channel_id: string;
    payload: {
        huddle_id: string;
        started_by: string;
        started_at: string;
    };
    emitted_at: string;
} | {
    type: 'huddle.ended';
    workspace_id: string;
    channel_id: string;
    payload: {
        huddle_id: string;
        ended_at: string;
        duration_seconds: number;
    };
    emitted_at: string;
} | {
    type: 'huddle.participant_joined';
    workspace_id: string;
    channel_id: string;
    user_id: string;
    payload: {
        huddle_id: string;
        joined_at: string;
    };
    emitted_at: string;
} | {
    type: 'huddle.participant_left';
    workspace_id: string;
    channel_id: string;
    user_id: string;
    payload: {
        huddle_id: string;
        left_at: string;
    };
    emitted_at: string;
};
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
    constructor(url: URLResolver);
    private resolveURL;
    start(): void;
    stop(): void;
    on(listener: Listener): () => void;
    onState(listener: (s: ConnectionState) => void): () => void;
    private setState;
    private connect;
}
export declare function realtimeURL(): string;
export declare function realtimeURLProvider(): () => Promise<string>;
//# sourceMappingURL=realtime.d.ts.map