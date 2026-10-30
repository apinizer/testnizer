/**
 * UTF-8 base64 for a Basic credential — `btoa` only takes Latin-1, so a
 * non-ASCII user name (`müller`) would throw; this encodes the UTF-8 bytes
 * the way the HTTP engine's `Buffer.from(…).toString('base64')` does.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '='
  }
  return out
}

/** True when the text still holds a `{{name}}` placeholder. */
export function hasPlaceholder(text: string): boolean {
  return /\{\{[^{}]*\}\}/.test(text)
}

/**
 * The literal `Basic …` value of a credential pair, or `undefined` when a
 * `{{name}}` placeholder is still in it: encoding `admin:{{pass}}` would hide
 * the placeholder (the "secret not included" note would go silent and the
 * snippet would be quietly wrong), so the variant renders the language's
 * basic-auth API or a run-time base64 expression instead.
 */
export function basicLiteral(username: string, password: string): string | undefined {
  const pair = `${username}:${password}`
  return hasPlaceholder(pair) ? undefined : `Basic ${base64Utf8(pair)}`
}
