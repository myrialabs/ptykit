/**
 * Shell resolution and working-directory handling (R1).
 *
 * Unix: `process.env.SHELL || /bin/bash`, interactive (no `-c`).
 * Windows: `powershell.exe -NoLogo`, interactive (no `-Command`).
 * Defaults: `xterm-256color`, 80×24.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { CheckShellResponse } from '../shared/index.js';

export const isWindows = process.platform === 'win32';

/** A resolved shell invocation. */
export interface ShellInvocation {
	shell: string;
	args: string[];
}

/** Resolve the interactive shell + args for this platform (R1). */
export function resolveShell(preferred?: string): ShellInvocation {
	if (isWindows) {
		return { shell: preferred || 'powershell.exe', args: ['-NoLogo'] };
	}
	return { shell: preferred || process.env.SHELL || '/bin/bash', args: [] };
}

/**
 * Resolve a requested working directory to an existing absolute path, falling
 * back to the user's home directory, then `process.cwd()`.
 */
export function resolveCwd(requested?: string): string {
	const home = (isWindows ? process.env.USERPROFILE : process.env.HOME) || homedir();

	if (requested && requested !== '~') {
		const expanded = requested.startsWith('~')
			? requested.replace('~', home || process.cwd())
			: resolve(requested);
		if (existsSync(expanded)) return expanded;
	}

	return home || process.cwd();
}

/** Report shell availability for the `check-shell` operation. */
export function checkShell(): CheckShellResponse {
	if (isWindows) {
		return {
			available: true,
			path: 'powershell.exe',
			platform: process.platform,
			isWindows: true,
			shellType: 'PowerShell',
		};
	}
	const path = process.env.SHELL || '/bin/bash';
	const shellType = (path.split('/').pop() || 'shell').replace(/^\w/, (c) => c.toUpperCase());
	return {
		available: true,
		path,
		platform: process.platform,
		isWindows: false,
		shellType,
	};
}
