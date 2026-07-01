/**
 * Collaborative rooms: two clients attach to ONE session and both see the same
 * live output — N clients ↔ 1 session.
 *
 *   bun run examples/collaborative.ts
 */

import { PtyKitManager, createPtyKitServer } from '../src/index.js';
import { PtyKitClient } from '../src/client/index.js';

const manager = new PtyKitManager();
const server = createPtyKitServer(manager, { path: '/pty' });
const bun = Bun.serve({ port: 0, fetch: server.fetch, websocket: server.websocket });
const url = `ws://localhost:${bun.port}/pty`;

const alice = new PtyKitClient({ url, namespace: 'team' });
const bob = new PtyKitClient({ url, namespace: 'team' });

// Both attach to the SAME sessionId — only one shell is spawned.
const a = await alice.create({ sessionId: 'team-terminal-1', cols: 80, rows: 24 });
const b = await bob.attach('team-terminal-1');

a.onData((c) => process.stdout.write(`\x1b[36m[alice]\x1b[0m ${c.replace(/\n/g, '\n[alice] ')}`));
b.onData((c) => process.stdout.write(`\x1b[35m[bob]\x1b[0m   ${c.replace(/\n/g, '\n[bob]   ')}`));

await Bun.sleep(300);
// Alice types; Bob sees the same output (and vice-versa).
a.write('echo "alice typed this"\r');
await Bun.sleep(600);
b.write('echo "bob typed this"\r');
await Bun.sleep(800);

console.log('\n--- both clients saw both commands ---');
alice.disconnect();
bob.disconnect();
manager.dispose();
bun.stop(true);
