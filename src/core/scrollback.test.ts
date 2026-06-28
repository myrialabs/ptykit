import { expect, test } from 'bun:test';
import { MemoryBufferStore } from './scrollback.js';

// @xterm/headless parses writes asynchronously, so give it a tick to process
// before reading the serialized frame (production reattach happens much later).
const flush = () => new Promise((r) => setTimeout(r, 20));

test('write + serialize round-trips visible content', async () => {
	const store = new MemoryBufferStore(1000);
	store.create('s1', 80, 24);
	store.write('s1', 'hello world');
	await flush();
	expect(store.serialize('s1')).toContain('hello world');
});

test('clear drops scrolled-back content (xterm keeps only the prompt line)', async () => {
	const store = new MemoryBufferStore();
	store.create('s1', 80, 24);
	store.write('s1', 'scrolled-away\r\nprompt-line');
	await flush();
	store.clear('s1');
	await flush();
	const frame = store.serialize('s1');
	expect(frame).not.toContain('scrolled-away');
	expect(frame).toContain('prompt-line');
});

test('serialize is empty for unknown session and after dispose', async () => {
	const store = new MemoryBufferStore();
	expect(store.serialize('nope')).toBe('');
	store.create('s1', 80, 24);
	store.write('s1', 'x');
	await flush();
	store.dispose('s1');
	expect(store.serialize('s1')).toBe('');
});

test('create is idempotent', async () => {
	const store = new MemoryBufferStore();
	store.create('s1', 80, 24);
	store.write('s1', 'keep');
	await flush();
	store.create('s1', 80, 24); // must not wipe existing buffer
	expect(store.serialize('s1')).toContain('keep');
});

test('resize does not throw and preserves content', async () => {
	const store = new MemoryBufferStore();
	store.create('s1', 80, 24);
	store.write('s1', 'resilient');
	await flush();
	store.resize('s1', 120, 40);
	await flush();
	expect(store.serialize('s1')).toContain('resilient');
});
