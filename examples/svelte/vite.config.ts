import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { PtyKit, createPtyKitServer } from '@myrialabs/ptykit';

/**
 * Mount the PtyKit WebSocket server directly onto Vite's dev HTTP server, so a
 * single `bun run dev` serves both the Svelte app and the /pty endpoint.
 * Run under Bun so the bun-pty backend is used.
 */
function ptykitServer() {
	return {
		name: 'ptykit-server',
		async configureServer(server: any) {
			const manager = new PtyKit({ scrollback: 5000 });
			const pty = createPtyKitServer(manager, { path: '/pty' });
			if (server.httpServer) await pty.attach(server.httpServer);
		},
	};
}

export default defineConfig({
	plugins: [svelte(), ptykitServer()],
	// ptykit/svelte ships raw .svelte source; let the svelte plugin compile it.
	optimizeDeps: { exclude: ['@myrialabs/ptykit'] },
	server: { port: 8785 },
});
