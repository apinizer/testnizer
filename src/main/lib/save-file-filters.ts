/**
 * Save-dialog filters for the generic `export:saveFile` bridge.
 *
 * The handler used to hard-code `[JSON, YAML, All Files]` for every caller.
 * On macOS the first filter decides the extension, so "Save HTML report…"
 * (MCP Security Scan, issue #142) suggested `mcp-security-….html` and the
 * dialog rewrote it to `.json`. The filter list now follows the suggested
 * file name; "All Files" is always last.
 *
 * Pure (no electron import) so it can be unit-tested in plain node —
 * `SaveFileFilter` is structurally Electron's `FileFilter`.
 */
import { extname } from 'node:path'

export interface SaveFileFilter {
  name: string
  extensions: string[]
}

const JSON_FILTER: SaveFileFilter = { name: 'JSON', extensions: ['json'] }
const YAML_FILTER: SaveFileFilter = { name: 'YAML', extensions: ['yaml', 'yml'] }
const HTML_FILTER: SaveFileFilter = { name: 'HTML', extensions: ['html', 'htm'] }
const ALL_FILES_FILTER: SaveFileFilter = { name: 'All Files', extensions: ['*'] }

/**
 * Primary filter(s) per lower-case extension; "All Files" is appended by the
 * caller. A Map, not an object literal — `x.constructor` must not resolve to
 * `Object.prototype.constructor`.
 */
const FILTERS_BY_EXTENSION = new Map<string, SaveFileFilter[]>([
  ['html', [HTML_FILTER]],
  ['htm', [HTML_FILTER]],
  ['json', [JSON_FILTER, YAML_FILTER]],
  ['yaml', [YAML_FILTER, JSON_FILTER]],
  ['yml', [YAML_FILTER, JSON_FILTER]],
  ['csv', [{ name: 'CSV', extensions: ['csv'] }]],
  ['xml', [{ name: 'XML', extensions: ['xml'] }]],
  ['txt', [{ name: 'Text', extensions: ['txt'] }]],
  ['md', [{ name: 'Markdown', extensions: ['md'] }]],
])

/** The pre-fix list — still used when the suggested name has no known extension. */
const DEFAULT_PRIMARY: SaveFileFilter[] = [JSON_FILTER, YAML_FILTER]

/** `'report.HTML'` → `'html'`; `''` when there is no extension (dotfiles included). */
function extensionOf(name: string): string {
  return extname(name ?? '')
    .replace(/^\./, '')
    .toLowerCase()
}

/**
 * Dialog filters for a suggested file name: the matching type first, then
 * (for JSON/YAML) its sibling, then "All Files". Unknown or missing
 * extension → the historical `[JSON, YAML, All Files]`.
 */
export function saveFileFiltersFor(defaultName: string): SaveFileFilter[] {
  const primary = FILTERS_BY_EXTENSION.get(extensionOf(defaultName)) ?? DEFAULT_PRIMARY
  return [...primary, ALL_FILES_FILTER].map((f) => ({
    name: f.name,
    extensions: [...f.extensions],
  }))
}

/**
 * A bare name typed into the Windows/Linux dialog (`report`) gets the
 * suggested name's extension (`report.html`). A path that already has an
 * extension — even a different one — is the user's explicit choice and is
 * returned unchanged, as is everything when the suggested name has none.
 */
export function ensureDefaultExtension(chosenPath: string, defaultName: string): string {
  const defaultExt = extname(defaultName ?? '')
  if (!defaultExt || defaultExt === '.') return chosenPath
  const chosenExt = extname(chosenPath)
  if (chosenExt !== '' && chosenExt !== '.') return chosenPath
  // `report.` → `report.html`, not `report..html`.
  return chosenPath.endsWith('.') ? chosenPath + defaultExt.slice(1) : chosenPath + defaultExt
}
