import { expect, test } from 'bun:test';
import { compile } from 'svelte/compiler';

// The component ships as raw .svelte source, so it is never tsc-built. Guard
// against regressions by compiling it with the Svelte compiler in CI.
test('PtyTerminal.svelte compiles under Svelte 5 with no warnings', async () => {
	const src = await Bun.file(new URL('./PtyTerminal.svelte', import.meta.url)).text();
	const { js, warnings } = compile(src, { name: 'PtyTerminal', generate: 'client' });
	expect(js.code.length).toBeGreaterThan(0);
	expect(warnings).toEqual([]);
});
