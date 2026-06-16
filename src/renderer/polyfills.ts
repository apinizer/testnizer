import { Buffer } from 'buffer'

// The browser renderer has no Node `Buffer` global, but the shared script
// runtime (src/shared/script) pulls in deps — crypto-js, xml2js,
// postman-collection, ajv, cheerio — that reference `Buffer` at module-eval
// time. Without this shim the renderer bundle throws
// "Uncaught ReferenceError: Buffer is not defined" before React mounts, leaving
// a blank #root (the v1.4.19 blank-UI regression introduced when the Send path
// migrated onto the shared runtime). This module MUST be imported FIRST in
// main.tsx so the global is installed before App's import graph evaluates.
const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer; global?: unknown }
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer
// Some CJS deps reference a bare `global`; alias it to globalThis defensively.
if (typeof g.global === 'undefined') g.global = globalThis
