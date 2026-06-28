/**
 * Core engine without a server: drive a `PtyKit` session directly and read its
 * serialized scrollback. Useful for capturing terminal output, tests, or custom
 * transports.
 *
 *   bun run examples/headless-capture.ts
 */

import { PtyKit } from '../src/index.js';

const manager = new PtyKit({ scrollback: 5000 });
const session = await manager.createSession({ sessionId: 'cap-1', namespace: 'local', cols: 80, rows: 24 });

// Listen to live output (batched, with a monotonic seq for dedup).
session.addDataListener((chunk, seq) => {
	process.stdout.write(`\x1b[2m(seq ${seq})\x1b[0m ${chunk}`);
});

await Bun.sleep(300);
session.write('echo "captured headlessly"\r');
await Bun.sleep(500);
session.write('uname -a\r');
await Bun.sleep(500);

// The serialized frame is a single replayable ANSI snapshot of the screen.
const frame = manager.getSerializedState('cap-1');
console.log('\n\n--- serialized frame length:', frame.length, 'bytes ---');

manager.dispose();
