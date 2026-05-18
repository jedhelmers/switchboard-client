// @stack/client — public entry point.
//
// Imports are organized so tree-shaking eliminates whatever a consumer
// doesn't touch. Most apps will use the React hooks (which transitively
// pull in everything they need); type-only or non-React consumers can
// import from "./client" directly for the fetch wrapper + types and skip
// the @tanstack/react-query dependency.
export * from './client';
export * from './realtime';
export * from './hooks';
export * from './plugins';
//# sourceMappingURL=index.js.map