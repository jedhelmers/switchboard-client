import type { ComponentType } from 'react';
export type SlashCommandContext = {
    channelId: string;
    workspaceSlug: string;
    currentUserID: string;
    isThread: boolean;
};
export type SlashCommandResult = {
    text?: string;
    payload?: unknown;
    file_ids?: string[];
} | null;
export type SlashCommand = {
    name: string;
    description?: string;
    usage?: string;
    run: (args: string, ctx: SlashCommandContext) => SlashCommandResult | Promise<SlashCommandResult>;
};
export declare function registerSlashCommand(cmd: SlashCommand): () => void;
export declare function getSlashCommand(name: string): SlashCommand | undefined;
export declare function listSlashCommands(): SlashCommand[];
export declare function parseSlashInput(input: string): {
    name: string;
    args: string;
} | null;
export type PayloadRendererProps<T = unknown> = {
    payload: T;
};
export type PayloadRenderer<T = unknown> = ComponentType<PayloadRendererProps<T>>;
export declare function registerPayloadRenderer<T = unknown>(type: string, component: PayloadRenderer<T>): () => void;
export declare function getPayloadRenderer(type: string): PayloadRenderer<unknown> | undefined;
export declare function resolvePayloadRenderer(payload: unknown): PayloadRenderer<unknown> | undefined;
export declare function isCustomPayload(payload: unknown): boolean;
//# sourceMappingURL=plugins.d.ts.map