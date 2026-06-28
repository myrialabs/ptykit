/**
 * Custom shell, working directory, and environment hygiene.
 *
 *   bun run examples/custom-shell-env.ts
 */

import { PtyKit } from '../src/index.js';

const manager = new PtyKit({
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

console.log('\n--- done ---');
manager.dispose();
