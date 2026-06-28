import { expect, test } from 'bun:test';
import { PTYKIT_VERSION } from './index.js';

test('exposes the package version', () => {
	expect(typeof PTYKIT_VERSION).toBe('string');
	expect(PTYKIT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test('entry barrels import without side effects', async () => {
	await expect(import('./index.js')).resolves.toBeDefined();
	await expect(import('./client/index.js')).resolves.toBeDefined();
	// The Svelte entry ships as raw .svelte source (compiled by the consumer's
	// bundler), so it is not importable as plain JS here.
});
