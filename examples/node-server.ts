/**
 * Mounting on a Node `http.Server` (instead of Bun.serve). Uses the optional
 * `ws` package. Runs under Bun too, since Bun implements `node:http`.
 *
 *   bun run examples/node-server.ts
 *   # or under Node:  node --experimental-strip-types examples/node-server.ts
 */

import http from 'node:http';
import { PtyKitManager, createPtyKitServer } from '../src/index.js';
import { PtyKitClient } from '../src/client/index.js';

const manager = new PtyKitManager();
const server = createPtyKitServer(manager, { path: '/pty' });

const httpServer = http.createServer((_req, res) => res.end('ptykit node server\n'));
await server.attach(httpServer);
await new Promise<void>((r) => httpServer.listen(0, r));
const { port } = httpServer.address() as { port: number };
console.log(`Node http.Server listening on ${port}`);

const client = new PtyKitClient({ url: `ws://localhost:${port}/pty`, namespace: 'demo' });
const session = await client.create({ sessionId: 'node-demo-1' });
session.onData((c) => process.stdout.write(c));

await new Promise((r) => setTimeout(r, 300));
session.write('echo "served from node:http + ws"\r');
await new Promise((r) => setTimeout(r, 800));

console.log('\n--- done ---');
client.disconnect();
manager.dispose();
httpServer.close();
