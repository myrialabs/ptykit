/**
 * WebSocket transport server — barrel.
 */

export {
	PtyKitServer,
	createPtyKitServer,
	type PtyKitServerOptions,
	type EmbeddedConnectionOptions,
	type AuthorizeContext,
	type AuthorizeHook,
	type AuthorizeOperation,
	type RoomContext,
	type RoomResolver,
	type UpgradeHook,
} from './pty-kit-server.js';
export { RoomRegistry, type PtyKitConnection } from './connection.js';
