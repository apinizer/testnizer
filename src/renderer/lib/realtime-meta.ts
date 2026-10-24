/**
 * WebSocket / Socket.IO saved-request metadata (issues #282 / #283). The ONE
 * writer and reader live in `src/shared/realtime-meta.ts` so the Postman v3
 * import / export in main (issues #276 / #277) writes and reads the very same
 * blocks; this module keeps the renderer's import path.
 */
export * from '../../shared/realtime-meta'
