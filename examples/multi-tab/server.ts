/**
 * Multi-tab browser example (Bun).
 *
 *   bun examples/multi-tab/server.ts
 *   # open http://localhost:8783
 *
 * A tabbed terminal manager: create, switch, and close sessions — each tab is a
 * separate PTY session in the same namespace. The browser bundle is built on the
 * fly with `Bun.build`.
 */

import { join } from 'node:path';
import { PtyKitManager, createPtyKitServer } from '../../src/index.js';

const manager = new PtyKitManager({ scrollback: 5000 });
const ptyServer = createPtyKitServer(manager, { path: '/pty' });

const here = import.meta.dir;
const html = await Bun.file(join(here, 'index.html')).text();
const build = await Bun.build({ entrypoints: [join(here, 'app.ts')], target: 'browser' });
const appJs = await build.outputs[0]!.text();

const server = Bun.serve({
	port: 8783,
	async fetch(request, srv) {
		const url = new URL(request.url);
		const upgraded = await ptyServer.fetch(request, srv);
		if (upgraded !== undefined) return upgraded;
		if (url.pathname === '/app.js') {
			return new Response(appJs, { headers: { 'content-type': 'text/javascript' } });
		}
		return new Response(html, { headers: { 'content-type': 'text/html' } });
	},
	websocket: ptyServer.websocket,
});

console.log(`multi-tab running at http://localhost:${server.port}`);
