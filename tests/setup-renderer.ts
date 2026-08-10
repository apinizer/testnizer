import '@testing-library/jest-dom/vitest'

/**
 * jsdom realm fix for WebCrypto-based libraries (jose, #73) — TEST-ONLY.
 *
 * Under vitest's jsdom environment `TextEncoder` comes from Node's `util` while
 * `Uint8Array` comes from the jsdom window realm, so
 * `new TextEncoder().encode(s) instanceof Uint8Array` is FALSE. jose guards its
 * inputs with exactly that check and throws "payload must be an instance of
 * Uint8Array" — even for the payload it encoded itself.
 *
 * A real Chromium renderer (dev http://localhost:5173 and packaged file://) has
 * ONE realm, so this never happens in the app — which is why the shim lives here
 * and NOT in src/renderer/polyfills.ts: production must not pay for a jsdom
 * artefact. Re-wrapping with `Uint8Array.from` keeps the bytes identical.
 */
const NodeTextEncoder = globalThis.TextEncoder
class RealmAlignedTextEncoder extends NodeTextEncoder {
  encode(input?: string): Uint8Array {
    return Uint8Array.from(super.encode(input))
  }
}
if (!(new NodeTextEncoder().encode('a') instanceof Uint8Array)) {
  globalThis.TextEncoder = RealmAlignedTextEncoder as typeof globalThis.TextEncoder
}
