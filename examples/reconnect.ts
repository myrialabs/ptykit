/**
 * Reconnect & status: the client auto-reconnects with backoff and re-attaches
 * its sessions when the server comes back. `onStatus` drives your UI.
 *
 *   bun run examples/reconnect.ts
 */

import { PtyKit, createPtyKitServer } from '../src/index.js';
import { PtyKitClient } from '../src/client/index.js';

function startServer(manager: PtyKit, port: number) {
	const server = createPtyKitServer(manager, { path: '/pty' });
	return Bun.serve({ port, fetch: server.fetch, websocket: server.websocket });
}

const manager = new PtyKit();
let bun = startServer(manager, 0);
const port = bun.port;
const url = `ws://localhost:${port}/pty`;

const client = new PtyKitClient({ url, namespace: 'demo', reconnect: { baseDelayMs: 200 } });
client.onStatus((s) => console.log(`[status] ${s}`));

const session = await client.create({ sessionId: 'demo-1' });
session.onData((c) => process.stdout.write(c));
await Bun.sleep(300);
session.write('echo "before the blip"\r');
await Bun.sleep(500);

// Simulate the server going away…
console.log('\n--- stopping server (network blip) ---');
bun.stop(true);
await Bun.sleep(600); // client goes 'reconnecting'

// …and coming back on the same port. The client reconnects + re-attaches.
console.log('--- restarting server ---');
bun = startServer(manager, port);
await Bun.sleep(800);

session.write('echo "after reconnecting"\r');
await Bun.sleep(700);

console.log('\n--- done ---');
client.disconnect();
manager.dispose();
bun.stop(true);
