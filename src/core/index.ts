/**
 * Core PTY session engine — barrel.
 */

export type {
	PtyBackend,
	PtyBackendName,
	PtyProcessHandle,
	PtySpawnOptions,
	PtyExitEvent,
	PtyDisposable,
} from './backend.js';
export { detectBackendName, isBun, loadBackend, resetBackendCache } from './detect.js';
export { buildPtyEnv, getCleanSpawnEnv, type EnvOptions } from './env.js';
export { checkShell, isWindows, resolveCwd, resolveShell, type ShellInvocation } from './shell.js';
export { MemoryBufferStore, type BufferStore } from './scrollback.js';
export {
	Session,
	type SessionConfig,
	type SessionInfo,
	type SessionDataListener,
	type SessionExitListener,
} from './session.js';
export {
	PtyKitManager,
	type PtyKitManagerOptions,
	type CreateSessionOptions,
} from './pty-kit.js';
