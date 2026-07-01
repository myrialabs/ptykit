/**
 * Minimal end-to-end: spin up a server, connect a client, run a command.
 *
 *   bun run examples/quick-start.ts
 *
 * In-repo this imports from `../src`; in your app import from `@myrialabs/ptykit` and
 * `@myrialabs/ptykit/client`.
 */

import { PtyKit, createPtyKitServer } from '../src/index.js';
import { PtyKitClient } from '../src/client/index.js';

const manager = new PtyKit();
const server = createPtyKitServer(manager, { path: '/pty' });
const bun = Bun.serve({ port: 0, fetch: server.fetch, websocket: server.websocket });

const client = new PtyKitClient({ url: `ws://localhost:${bun.port}/pty`, namespace: 'demo' });
const session = await client.create({ sessionId: 'demo-1', cols: 80, rows: 24 });

session.onData((chunk) => process.stdout.write(chunk));

await Bun.sleep(300); // let the shell paint its prompt
session.write('echo "hello from ptykit"\r');
await Bun.sleep(800);

console.log('\n--- done ---');
client.disconnect();
manager.dispose();
bun.stop(true);
