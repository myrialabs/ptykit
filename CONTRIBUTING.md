# Contributing Guide

Thanks for considering a contribution to **ptykit**. This guide covers the dev
setup, conventions, and the submission process.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.2+ (used for dev, tests, and CI). `bun-pty` is the
  tested PTY backend and runs under Bun.
- Node 18+ if you want to exercise the experimental `node-pty` path.

ptykit ships as a TypeScript ESM library running on **Node 18+ and Bun**, with a
browser client entry. Use `bun` for all package management and scripts.

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/ptykit.git
cd ptykit
git remote add upstream https://github.com/myrialabs/ptykit.git
bun install
bun run typecheck && bun run lint && bun run test && bun run build
```

All of these should pass on a fresh clone.

---

## Development Workflow

```bash
git checkout main && git pull upstream main
git checkout -b feature/your-feature
# develop & verify:
bun run typecheck && bun run lint && bun run test && bun run build
git commit -m "feat(server): enforce anti-hijack on attach"
git push origin feature/your-feature   # then open a PR targeting main
```

---

## Project Principles

Non-negotiable — a PR that breaks one needs explicit discussion first:

- **WebSocket only.** No SSE, no `transport` option in the public API.
- **Cross-runtime core.** `src/` must run on Node 18+ and Bun. The PTY backend is
  chosen by runtime auto-detect (`bun-pty` on Bun, `node-pty` on Node) via
  dynamic import; gate `Bun.*` / `node:*` behind feature checks.
- **bun-pty is the tested path; node-pty is experimental** until the scale and
  auto-detect benchmarks gate it. Don't quietly promote it — keep the type/docs honest.
- **Persist output to the headless terminal first**, even with zero listeners,
  and reattach via **serialized replay** (not raw byte history). Clear old
  listeners before attaching new ones.
- **Collaborative by default.** Output broadcasts to a room; the client filters
  by `sessionId`. N clients ↔ 1 session must keep working.
- **Quiet core.** The library never writes to stdout/stderr on its own; diagnostics
  go through an injectable logger, off by default.
- **Public API changes are documented.** Update `README.md` and the relevant
  `docs/*.md` in the same PR.

---

## Code Style

- TypeScript, strict mode. `const` by default; `let` only when reassigned.
- ESM with explicit `.js` import specifiers (required by `NodeNext`).
- Tabs, single quotes, semicolons. No Prettier — manual consistency.
- Naming: `camelCase` values, `PascalCase` types/classes, `UPPER_SNAKE_CASE`
  constants, `kebab-case` files.
- `any` is acceptable only at the runtime boundary (Bun globals, dynamically
  imported `bun-pty`/`node-pty`, xterm addon shapes, framework payloads).

### Tests

Add a `*.test.ts` next to the source using `bun:test` for any non-trivial logic
where a regression would be silent — idempotent create, `seq` dedup, env
hygiene, kill semantics, serialize-replay correctness, `authorize` allow/deny,
room fan-out, reconnect/heal, fit debounce.

```bash
bun test src/core/session.test.ts   # single file
bun test                            # full suite
```

---

## Submitting Changes

All repository-facing text — branch names, commit messages, PR titles and
descriptions, PR comments — must be in **English**.

### Branch Naming

`<type>/<description>` — lowercase, kebab-case, exactly one `/`.
Types: `feature/`, `fix/`, `docs/`, `chore/`.

### Commit Messages

`<type>(<scope>): <subject>` — imperative, lowercase, no period, ≤72 chars.
Types: `feat`, `fix`, `docs`, `chore`, `release`.
Common scopes: `core`, `backend`, `server`, `client`, `svelte`, `bench`,
`readme`, `examples`.

```
feat(core): idempotent createSession reuses by id
fix(client): heal-reconnect on open-but-dead socket
docs(server): document the authorize hook contract
```

### Pre-commit Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run test` passes
- [ ] `bun run build` emits `dist/` cleanly
- [ ] Public API change reflected in `README.md` + `docs/`

### Pull Request Description Template

```markdown
## Summary
What this PR does, in a sentence or two.

## Why
The motivation — bug it fixes, behavior it changes.

## Changes
- concrete bullet list

## Notes (optional)
Trade-offs, follow-ups.
```

Add `## Breaking changes` with a migration note whenever the public API changes.

---

## Reference

```bash
bun run typecheck     # tsc --noEmit
bun run lint          # eslint
bun run test          # bun:test
bun run build         # emit dist/
```

- [TypeScript Docs](https://www.typescriptlang.org/docs/)
- [Bun Docs](https://bun.sh/docs)
- [Conventional Commits](https://www.conventionalcommits.org/)

## Questions?

- [Issues](https://github.com/myrialabs/ptykit/issues)
