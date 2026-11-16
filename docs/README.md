# PtyKit documentation

PtyKit serves interactive PTY sessions over WebSocket for Node 18+ and Bun,
with collaborative rooms, serialized-scrollback reattach, and a resilient
browser client behind one typed API. This index links every doc page; the
root [README](../README.md) is the shorter pitch, this is the reference.

## Getting Started

| Page | What it answers |
| --- | --- |
| [Quick start](./getting-started/quick-start.md) | How do I install ptykit and get a server + browser terminal running? |

## Essential

| Page | What it answers |
| --- | --- |
| [Core concepts](./essential/core-concepts.md) | What's a session, a room, a reattach frame? How does `authorize` fit in, and how is the backend picked? |

## SDK

| Page | What it answers |
| --- | --- |
| [Server](./sdk/server.md) | How do I mount `createPtyKitServer`, configure `PtyKitManager`, give each session its own environment, and use rooms / the embedded transport? |
| [Client](./sdk/client.md) | How do I use `mountTerminal`, `mountViewer`, `PtyKitClient`, themes, `attachFit`, and `hostSocket`? |
| [Svelte](./sdk/svelte.md) | What props and events does `<PtyTerminal/>` support? |

## Operations

| Page | What it answers |
| --- | --- |
| [Production](./operations/production.md) | How do I harden `authorize` for deployment, what's the bun-pty/node-pty status, and what does ptykit actually measure for throughput/latency/memory? |

## Reference

| Page | What it answers |
| --- | --- |
| [API reference](./reference/api.md) | What does every entry point (`ptykit`, `/core`, `/server`, `/client`, `/svelte`, `/xterm`) export? |

## Examples

Runnable scenarios (collaboration, reattach, reconnect, authorization, custom
shell/env, and four browser apps including a Svelte one) live in
[`examples/`](../examples/README.md) — each one is a self-contained file or
folder you can run directly with Bun.
