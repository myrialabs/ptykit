/**
 * Custom shell, working directory, environment hygiene, and per-session env.
 *
 * The manager's `env` is deployment-wide policy. `createSession({ env })` is the
 * per-session half, for values that differ between one session and the next.
 * Server-hosted sessions reach the same thing through the `env` hook on
 * `createPtyKitServer` — see docs/server.md#per-session-environment.
 *
 *   bun run examples/custom-shell-env.ts
 */

import { PtyKitManager } from '../src/index.js';

const manager = new PtyKitManager({
	// Strip Bun/npm/Vite pollution from the child env, then inject your own.
	env: {
		sanitize: true,
		inject: { PTYKIT_EXAMPLE: 'hello', PROMPT_MARKER: '>>' },
	},
});

const session = await manager.createSession({
	sessionId: 'env-1',
	namespace: 'local',
	shell: '/bin/sh', // force a specific shell instead of $SHELL
	cwd: '/tmp', // start in /tmp
	cols: 100,
	rows: 30,
});

session.addDataListener((chunk) => process.stdout.write(chunk));

await Bun.sleep(300);
session.write('pwd\r'); // → /tmp
await Bun.sleep(400);
session.write('echo "PTYKIT_EXAMPLE=$PTYKIT_EXAMPLE"\r'); // → hello
await Bun.sleep(400);
session.write('echo "npm_config_*=${npm_config_cache:-<stripped>}"\r'); // → <stripped>
await Bun.sleep(500);

// ---- Per-session environment ----------------------------------------------
// A second session under the same manager, with its own variables. They are
// merged over the manager's `inject`, and win where the names collide.
console.log('\n--- second session, per-session env ---');

const scoped = await manager.createSession({
	sessionId: 'env-2',
	namespace: 'local',
	shell: '/bin/sh',
	env: { PROMPT_MARKER: '$$', SESSION_OWNER: 'alice' },
});

scoped.addDataListener((chunk) => process.stdout.write(chunk));

await Bun.sleep(300);
scoped.write('echo "PTYKIT_EXAMPLE=$PTYKIT_EXAMPLE"\r'); // → hello (from the manager)
await Bun.sleep(400);
scoped.write('echo "PROMPT_MARKER=$PROMPT_MARKER"\r'); // → $$ (per-session wins)
await Bun.sleep(400);
scoped.write('echo "SESSION_OWNER=$SESSION_OWNER"\r'); // → alice
await Bun.sleep(500);

// The first session never saw those variables — env is per session, not shared.
session.write('echo "SESSION_OWNER=${SESSION_OWNER:-<unset here>}"\r'); // → <unset here>
await Bun.sleep(500);

console.log('\n--- done ---');
manager.dispose();
