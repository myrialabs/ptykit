# Maintainers Guide

Internal guide for ptykit maintainers. External contributors follow
[CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Guiding Principles

- **Audit before asking the contributor to validate.** Read the full diff and
  adjacent code before requesting changes.
- **Protect the invariants.** WebSocket-only transport, cross-runtime core,
  persist-to-headless-first with serialized replay, the collaborative room model,
  enforced `authorize`, and a quiet core are load-bearing. A PR that breaks one
  needs explicit, measured justification.
- **Decide from evidence.** When a behavior is disputed, the answer is a test or
  a benchmark, not an opinion. Cite `file:line`.
- **Keep node-pty honest.** It stays experimental until the scale/auto-detect
  benchmarks produce the data. Don't let a PR promote it on vibes.
- **Default to the established pattern.** New mechanisms need a reason the
  existing shape (`PtyKit` / `PtyBackend` / `createPtyKitServer` / `PtyKitClient`)
  doesn't fit.
- **Warm, brief, substantive — in that order.** Open by naming something specific
  the contributor did well. `file:line` inline for technical points.
- **Attribution always.** Whether you build on a branch or close-and-replace, the
  original find earns credit.

---

## The PR Lifecycle

1. **Intake** — `gh pr checkout <N>`, read the entire diff first.
2. **Audit** — check:
   - **Invariants** — WS-only, cross-runtime, serialized-replay, room model,
     authorize, quiet core.
   - **Correctness** — reattach loses no data and never double-writes; `seq`
     dedup holds; kill semantics match R19.
   - **Adjacent code** — same-shape gaps the PR didn't touch.
   - **Tests** — is there a `*.test.ts` where CONTRIBUTING expects one?
   - **Before/after** — walk one concrete scenario in user terms.
3. **Choose a path** (below).
4. **Merge** — squash-merge via the GitHub UI; subject = PR title `(#N)`; body
   empty except a `Co-authored-by:` trailer when reshaping a contributor's work;
   delete the branch.

### Review Paths

| Situation | Path |
|---|---|
| Audit clean | **Approve & merge.** Short approval naming what they did well; note checks green; merge. |
| Right shape, small additions, contributor engaged | **Iterate on the branch.** Push a *new* commit (never amend theirs); `merge` (not rebase) to sync `main`. |
| Out-of-scope same-shape gaps | **Merge as-is, follow-up PR.** Credit the find; open `fix/<scope>-…`. |
| Substantive concerns, you might lack context | **Comment & wait.** Warm opener, `file:line` concerns, the question that would flip your position, a plain-English deadline, explicit auto-stale consequence. |
| Shape must change | **Close & replace.** Explain why with `file:line`; open a replacement crediting them via `Co-authored-by:`. |

When unsure between "comment & wait" and a close, default to comment & wait.

---

## Communication Norms

- **All PR-facing text in English**, warmly, even when the maintainer
  conversation is in another language.
- **Don't link this file from PR comments.** Reference CONTRIBUTING.md instead.
- **Resolve conflicts locally**, never via the web UI. Never `--no-verify`.
  Never force-push to `main`.

---

## Release Process

Tag-driven, automated by `.github/workflows/ci.yml`. The `publish` job runs only
on `v*.*.*` tags, after `ci` (typecheck, lint, test, build, verify dist),
`node-matrix`, and `pack` pass.

```bash
git checkout main && git pull origin main
# bump "version" in package.json
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

The workflow runs `npm publish --provenance --access public` (using `NPM_TOKEN`)
and creates a GitHub release with generated notes.

**One-time prerequisites:**
- `NPM_TOKEN` repository secret with publish rights to `ptykit`.
- The published tarball must contain `dist/`; `package.json#files` lists it.
  Verify with `npm pack`.

**Versioning (semver):** `fix` → patch, `feat` → minor, breaking public-API
change → major. While `node-pty` is experimental, changes to that path are not
breaking changes to the supported (`bun-pty`) surface.

---

## Co-authored-by Trailer

```
Co-authored-by: Full Name <email@example.com>
```

Get the email via `git log <branch> -1 --format='%ae'`.
