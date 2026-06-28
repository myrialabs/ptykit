/**
 * Runnable basic example (Bun).
 *
 *   bun examples/basic/server.ts
 *   # open http://localhost:8781
 *
 * Serves a single page that mounts a terminal with `ptykit/client`'s
 * `mountTerminal`, and mounts the PtyKit WebSocket server at /pty. The browser
 * bundle is built on the fly with `Bun.build` so the example needs no separate
 * build step.
 *
 * NOTE: this in-repo example imports from `../../src/...`. A published app would
 * import from `ptykit` and `ptykit/client`.
 */

import { join } from 'node:path';
import { PtyKit, createPtyKitServer } from '../../src/index.js';

const manager = new PtyKit({ scrollback: 5000 });

// authorize defaults to allow-all here — fine for localhost, NEVER for production.
const ptyServer = createPtyKitServer(manager, { path: '/pty' });

const here = import.meta.dir;

const html = await Bun.file(join(here, 'index.html')).text();

// Bundle the browser app once at startup.
const build = await Bun.build({
	entrypoints: [join(here, 'app.ts')],
	target: 'browser',
});
const appJs = await build.outputs[0]!.text();

const server = Bun.serve({
	port: 8781,
	async fetch(request, srv) {
		const url = new URL(request.url);

		// Let the PTY server handle WebSocket upgrades on /pty.
		const upgraded = await ptyServer.fetch(request, srv);
		if (upgraded !== undefined) return upgraded;

		if (url.pathname === '/app.js') {
			return new Response(appJs, { headers: { 'content-type': 'text/javascript' } });
		}
		return new Response(html, { headers: { 'content-type': 'text/html' } });
	},
	websocket: ptyServer.websocket,
});

console.log(`basic running at http://localhost:${server.port}`);
