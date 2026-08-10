/**
 * Unicode-safe filename sanitiser for suggested export/save filenames.
 *
 * Every export path used to run the project/folder/suite name through an
 * ASCII whitelist (`/[^a-zA-Z0-9-_]/g → '_'`), so a Turkish project called
 * "sağlık_bakanlığı" was suggested as "sa_l_k_bakanl___.json" (issue #71).
 * Nothing about ext4/APFS/NTFS requires that: all three store filenames as
 * Unicode. So we invert the rule — keep every letter/digit/mark from any
 * script (Turkish, Greek, Cyrillic, CJK, emoji) and strip only what a
 * filesystem or shell actually rejects.
 */

/**
 * Characters no filesystem in our matrix accepts inside a single path
 * segment: POSIX/Windows separators, the Windows-illegal set, and ASCII
 * control chars (incl. DEL, which mangles terminal output).
 */
// eslint-disable-next-line no-control-regex -- control chars are exactly what we strip
const ILLEGAL_RUN = /[\\/<>:"|?*\u0000-\u001f\u007f]+/g

/** Windows device names — reserved with or without an extension. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Cap in code points (not UTF-16 units, so an emoji is never cut in half).
 * Callers append `-YYYY-MM-DD.json`, and 255 bytes is the common limit, so
 * 100 leaves room even when every char is a 3-byte CJK glyph.
 */
const MAX_LENGTH = 100

/**
 * Turn an arbitrary user-supplied name into a filesystem-safe filename part.
 * Never returns an empty string — falls back to `fallback` when the input
 * sanitises down to nothing (empty, whitespace-only, all-illegal).
 */
export function safeFileName(raw: string, fallback = 'export'): string {
  // A run of illegal chars collapses to one '_' so "a/b\\c" → "a_b_c".
  const replaced = (raw ?? '').replace(ILLEGAL_RUN, '_')

  // Windows silently drops trailing dots/spaces (so the file that appears
  // differs from the name we suggested); a leading dot hides it on POSIX.
  const trimmed = replaced.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')

  const chars = Array.from(trimmed)
  const capped = (
    chars.length > MAX_LENGTH ? chars.slice(0, MAX_LENGTH).join('') : trimmed
  ).replace(/[.\s]+$/, '')

  // Nothing of substance left (e.g. the name was only separators) — a bare
  // "_" is a worse suggestion than the caller's fallback.
  if (capped.length === 0 || /^_+$/.test(capped)) return fallback

  // "CON.json" is unopenable on Windows; prefixing keeps the extension intact.
  const stem = capped.split('.')[0] ?? ''
  return RESERVED_DEVICE.test(stem) ? `_${capped}` : capped
}
