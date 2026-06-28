/**
 * Reattach: a client runs a command and disconnects; a fresh client attaches to
 * the same session and replays the serialized scrollback — zero data loss, no
 * double output. Input keeps working afterward.
 *
 *   bun run examples/reattach.ts
 */

import { PtyKit, createPtyKitServer } from '../src/index.js';
import { PtyKitClient } from '../src/client/index.js';

const manager = new PtyKit();
const server = createPtyKitServer(manager, { path: '/pty' });
const bun = Bun.serve({ port: 0, fetch: server.fetch, websocket: server.websocket });
const url = `ws://localhost:${bun.port}/pty`;

// First client: run a command, then disconnect.
const first = new PtyKitClient({ url, namespace: 'demo' });
const s1 = await first.create({ sessionId: 'demo-1' });
await Bun.sleep(300);
s1.write('echo "this ran BEFORE the refresh"\r');
await Bun.sleep(700);
console.log('--- first client disconnecting (simulating a browser refresh) ---');
first.disconnect();

await Bun.sleep(300);

// Second client: attach to the SAME session. The replay shows the earlier output.
const second = new PtyKitClient({ url, namespace: 'demo' });
const s2 = await second.attach('demo-1');
console.log('--- second client attached; replayed screen: ---');
s2.onData((c) => process.stdout.write(c));
await Bun.sleep(300);

// Input still works after reattach.
s2.write('echo "and this ran AFTER reattaching"\r');
await Bun.sleep(700);

console.log('\n--- done ---');
second.disconnect();
manager.dispose();
bun.stop(true);
