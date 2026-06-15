/**
 * UTF-8-safe base64 that works in BOTH the renderer (browser globals) and the
 * main process (Node Buffer). Used for `pm.response.dataURI()` and the
 * `atob`/`btoa` script globals.
 */
interface Base64Globals {
  btoa?: (s: string) => string
  atob?: (s: string) => string
  Buffer?: { from(input: string, enc: string): { toString(enc: string): string } }
}

export function base64Encode(str: string): string {
  const g = globalThis as unknown as Base64Globals
  if (g.Buffer) return g.Buffer.from(str, 'utf-8').toString('base64')
  if (typeof g.btoa === 'function') {
    // btoa is latin1-only; widen via percent-encoding so UTF-8 survives.
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return g.btoa(bin)
  }
  throw new Error('base64 encoding unavailable in this runtime')
}

export function base64Decode(b64: string): string {
  const g = globalThis as unknown as Base64Globals
  if (g.Buffer) return g.Buffer.from(b64, 'base64').toString('utf-8')
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }
  throw new Error('base64 decoding unavailable in this runtime')
}
