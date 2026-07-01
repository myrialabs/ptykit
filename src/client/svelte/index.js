// Entry for `@myrialabs/ptykit/svelte`. Hand-written (not tsc-built) so the package can
// ship the raw `.svelte` component, which Svelte-aware bundlers compile via the
// `svelte` export condition. Types live in `index.d.ts`.
export { default, default as PtyTerminal } from './PtyTerminal.svelte';
