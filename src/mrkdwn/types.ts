// AST node types for the SwitchBoard mrkdwn dialect.
// The contract — including tokenizer rules and the canonical AST shape
// — lives in MRKDWN.md in the switchboard-server repo. The shared
// fixture file MRKDWN_FIXTURES.json is the test oracle that every
// parser (this one, the Go server-side one, and any future native
// client parser) must pass.

export type MrkdwnStyle = 'bold' | 'italic' | 'strike'

export type MrkdwnNode =
  | { type: 'text'; value: string }
  | { type: 'emphasis'; style: MrkdwnStyle; children: MrkdwnNode[] }
  | { type: 'code_inline'; value: string }
  | { type: 'code_block'; lang: string; value: string }
  | { type: 'link'; url: string; children: MrkdwnNode[] }
  | { type: 'paragraph'; children: MrkdwnNode[] }
  | { type: 'blockquote'; children: MrkdwnNode[] }
  | { type: 'list'; ordered: boolean; items: MrkdwnNode[][] }
