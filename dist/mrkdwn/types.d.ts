export type MrkdwnStyle = 'bold' | 'italic' | 'strike';
export type MrkdwnNode = {
    type: 'text';
    value: string;
} | {
    type: 'emphasis';
    style: MrkdwnStyle;
    children: MrkdwnNode[];
} | {
    type: 'code_inline';
    value: string;
} | {
    type: 'code_block';
    lang: string;
    value: string;
} | {
    type: 'link';
    url: string;
    children: MrkdwnNode[];
} | {
    type: 'paragraph';
    children: MrkdwnNode[];
} | {
    type: 'blockquote';
    children: MrkdwnNode[];
} | {
    type: 'list';
    ordered: boolean;
    items: MrkdwnNode[][];
};
//# sourceMappingURL=types.d.ts.map