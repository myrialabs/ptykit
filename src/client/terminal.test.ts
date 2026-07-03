import { beforeEach, expect, mock, test } from 'bun:test';

// Stub the optional xterm peer deps so `mountTerminal` runs headless (no DOM).
// `mountTerminal` imports them lazily, so registering the mocks here — before any
// call — is enough.
class FakeTerminal {
	static instances: FakeTerminal[] = [];
	cols = 80;
	rows = 24;
	readonly options: any;
	readonly written: string[] = [];
	readonly addons: any[] = [];
	dataCb: ((d: string) => void) | undefined;
	opened: unknown;
	disposed = false;
	constructor(options: any) {
		this.options = options;
		FakeTerminal.instances.push(this);
	}
	unicode = { activeVersion: '6' };
	loadAddon(a: any): void {
		this.addons.push(a);
	}
	open(el: unknown): void {
		this.opened = el;
	}
	write(c: string): void {
		this.written.push(c);
	}
	onData(cb: (d: string) => void): void {
		this.dataCb = cb;
	}
	focus(): void {}
	dispose(): void {
		this.disposed = true;
	}
}
class FakeFitAddon {
	fit(): void {}
	proposeDimensions(): { cols: number; rows: number } {
		return { cols: 80, rows: 24 };
	}
}

mock.module('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
mock.module('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }));
// The built-in optional addons default ON; mock them so imports resolve fast and
// deterministically (a real dynamic import from disk is a macrotask and would
// race the test's create-session response).
class FakeClipboardAddon {}
class FakeWebLinksAddon {}
class FakeUnicode11Addon {}
class FakeLigaturesAddon {}
mock.module('@xterm/addon-clipboard', () => ({ ClipboardAddon: FakeClipboardAddon }));
mock.module('@xterm/addon-web-links', () => ({ WebLinksAddon: FakeWebLinksAddon }));
mock.module('@xterm/addon-unicode11', () => ({ Unicode11Addon: FakeUnicode11Addon }));
mock.module('@xterm/addon-ligatures', () => ({ LigaturesAddon: FakeLigaturesAddon }));

const { mountTerminal } = await import('./terminal.js');
const { PtyKitClient } = await import('./pty-kit-client.js');
const { MockWebSocket, mockFactory, respondTo, tick } = await import('./fake-socket.js');

beforeEach(() => {
	MockWebSocket.reset();
	FakeTerminal.instances = [];
});

function makeClient() {
	return new PtyKitClient({ url: 'ws://test/pty', namespace: 'ns1', WebSocketImpl: mockFactory() });
}

/** Drive a successful `mountTerminal` against a shared, already-open client. */
async function mount(opts: Record<string, unknown> = {}) {
	const client = makeClient();
	const socket = MockWebSocket.instances[0]!;
	socket.accept();
	const target = {} as unknown as HTMLElement;
	const p = mountTerminal(target, { url: 'ws://test/pty', client, sessionId: 's1', create: true, ...opts });
	await tick(0);
	respondTo(socket, 'create-session', { sessionId: 's1', streamId: 's1-s', pid: 1, currentDirectory: '/tmp', cols: 80, rows: 24 });
	return { handle: await p, socket, client, target };
}

test('opens the terminal on the target and applies appearance options', async () => {
	const { handle, target } = await mount({ fontSize: 17, scrollback: 1234 });
	const term = handle.terminal as FakeTerminal;
	expect(term.opened).toBe(target);
	expect(term.options.fontSize).toBe(17);
	expect(term.options.scrollback).toBe(1234);
	expect(handle.fitAddon).toBeInstanceOf(FakeFitAddon);
});

test('applies the dark theme preset by default and swaps via setTheme', async () => {
	const { handle } = await mount();
	const term = handle.terminal as FakeTerminal;
	expect(term.options.theme.background).toBe('#0f172a'); // dark preset
	handle.setTheme('light');
	expect(term.options.theme.background).toBe('#ffffff'); // light preset
});

test('accepts a theme preset name and a custom theme object', async () => {
	const named = await mount({ theme: 'light' });
	expect((named.handle.terminal as FakeTerminal).options.theme.background).toBe('#ffffff');

	MockWebSocket.reset();
	FakeTerminal.instances = [];
	const custom = await mount({ theme: { background: 'rgba(0,0,0,0)' } });
	expect((custom.handle.terminal as FakeTerminal).options.theme.background).toBe('rgba(0,0,0,0)');
});

test('writes server output to the terminal and also calls onData', async () => {
	const got: string[] = [];
	const { handle, socket } = await mount({ onData: (c: string) => got.push(c) });
	socket.serverSend({ action: 'output', payload: { sessionId: 's1', content: 'hi', seq: 1 } });
	expect((handle.terminal as FakeTerminal).written).toContain('hi');
	expect(got).toContain('hi');
});

test('forwards terminal keystrokes to the session as input', async () => {
	const { handle, socket } = await mount();
	(handle.terminal as FakeTerminal).dataCb!('ls\r');
	expect((socket.lastFrame('input')!.payload as any)).toEqual({ sessionId: 's1', data: 'ls\r' });
});

test('fit:false skips the FitAddon', async () => {
	const { handle } = await mount({ fit: false });
	expect(handle.fitAddon).toBeUndefined();
	const addons = (handle.terminal as FakeTerminal).addons;
	expect(addons.some((a) => a instanceof FakeFitAddon)).toBe(false);
});

test('built-in addons load by default', async () => {
	const { handle } = await mount();
	const addons = (handle.terminal as FakeTerminal).addons;
	expect(addons.some((a) => a instanceof FakeClipboardAddon)).toBe(true);
	expect(addons.some((a) => a instanceof FakeWebLinksAddon)).toBe(true);
	expect(addons.some((a) => a instanceof FakeUnicode11Addon)).toBe(true);
	expect(addons.some((a) => a instanceof FakeLigaturesAddon)).toBe(true);
});

test('built-in addons opt out with false', async () => {
	const { handle } = await mount({ clipboard: false, webLinks: false, unicode11: false, ligatures: false });
	const addons = (handle.terminal as FakeTerminal).addons;
	expect(addons.some((a) => a instanceof FakeClipboardAddon)).toBe(false);
	expect(addons.some((a) => a instanceof FakeLigaturesAddon)).toBe(false);
});

test('dispose tears down the terminal but leaves a shared client connected', async () => {
	const { handle, client } = await mount();
	expect(client.connected()).toBe(true);
	handle.dispose();
	expect((handle.terminal as FakeTerminal).disposed).toBe(true);
	handle.dispose(); // idempotent
	expect(client.connected()).toBe(true); // not our client → not disconnected
});

test('rejects and calls onError (and disposes) when create fails', async () => {
	const client = makeClient();
	const socket = MockWebSocket.instances[0]!;
	socket.accept();
	let errored: unknown;
	const p = mountTerminal({} as unknown as HTMLElement, {
		url: 'ws://test/pty',
		client,
		sessionId: 's1',
		create: true,
		onError: (e) => (errored = e),
	});
	await tick(0);
	const reqId = (socket.lastFrame('create-session')!.payload as any).requestId;
	socket.serverSend({ action: 'create-session:response', payload: { requestId: reqId, success: false, error: 'boom' } });

	await expect(p).rejects.toThrow('boom');
	expect(errored).toBeInstanceOf(Error);
	expect(FakeTerminal.instances[0]!.disposed).toBe(true);
});
