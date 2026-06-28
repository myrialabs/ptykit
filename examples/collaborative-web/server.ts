/**
 * Collaborative browser example (Bun).
 *
 *   bun examples/collaborative-web/server.ts
 *   # open http://localhost:8782
 *
 * Two terminal panes on ONE page attach to the SAME session — type in either and
 * both update live. The browser bundle is built on the fly with `Bun.build`.
 *
 * In-repo this imports from `../../src`; a published app imports from `ptykit`.
 */

import { join } from 'node:path';
import { PtyKit, createPtyKitServer } from '../../src/index.js';

const manager = new PtyKit({ scrollback: 5000 });
const ptyServer = createPtyKitServer(manager, { path: '/pty' });

const here = import.meta.dir;
const html = await Bun.file(join(here, 'index.html')).text();
const build = await Bun.build({ entrypoints: [join(here, 'app.ts')], target: 'browser' });
const appJs = await build.outputs[0]!.text();

const server = Bun.serve({
	port: 8782,
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

console.log(`collaborative-web running at http://localhost:${server.port}`);
