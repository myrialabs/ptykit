/**
 * Access control: the `authorize` hook gates every operation, and the identity
 * comes from `onUpgrade`. Anti-hijack is automatic — a connection can only touch
 * sessions in namespaces it is authorized for.
 *
 *   bun run examples/authorize.ts
 */

import { PtyKit, createPtyKitServer } from '../src/index.js';
import { PtyKitClient } from '../src/client/index.js';

const manager = new PtyKit();

const server = createPtyKitServer(manager, {
	path: '/pty',
	// Identity is attached at the WebSocket upgrade (read a token, cookie, etc.).
	onUpgrade: (request: Request) => {
		const user = new URL(request.url).searchParams.get('user') ?? 'anon';
		return { user };
	},
	// Only members of a namespace may use it. Replace with your real check.
	authorize: ({ namespace, conn }) => {
		const allowed: Record<string, string[]> = { 'team-a': ['alice'], 'team-b': ['bob'] };
		return (allowed[namespace] ?? []).includes(conn.data.user as string);
	},
});

const bun = Bun.serve({ port: 0, fetch: server.fetch, websocket: server.websocket });
const url = (user: string) => `ws://localhost:${bun.port}/pty?user=${user}`;

// Alice is a member of team-a → allowed.
const alice = new PtyKitClient({ url: url('alice'), namespace: 'team-a' });
try {
	await alice.create({ sessionId: 'team-a-1' });
	console.log('✅ alice created a session in team-a');
} catch (err) {
	console.log('❌ alice was denied:', (err as Error).message);
}

// Alice is NOT a member of team-b → denied.
const aliceInB = new PtyKitClient({ url: url('alice'), namespace: 'team-b' });
try {
	await aliceInB.create({ sessionId: 'team-b-1' });
	console.log('✅ alice created a session in team-b (unexpected!)');
} catch (err) {
	console.log('🔒 alice was correctly denied in team-b:', (err as Error).message);
}

alice.disconnect();
aliceInB.disconnect();
manager.dispose();
bun.stop(true);
