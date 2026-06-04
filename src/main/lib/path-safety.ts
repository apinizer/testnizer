import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Resolve a renderer-supplied path and assert it lives inside the system
 * temp directory under one of the allowed prefixes. Throws on any path
 * that escapes via `..`, symlink traversal-style absolute paths, or that
 * targets a directory we didn't create.
 *
 * Used by IPC handlers (gitReadFile / gitCleanup / gitListFiles) that
 * take a path from the renderer and then read or delete it — without
 * this guard a compromised renderer could rmSync arbitrary disk paths.
 */
export function assertTmpSubpath(rawPath: string, allowedPrefixes: readonly string[]): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new Error('Invalid path: empty')
  }
  const resolved = path.resolve(rawPath)
  const tmpRoot = path.resolve(tmpdir())
  const rootWithSep = tmpRoot.endsWith(path.sep) ? tmpRoot : tmpRoot + path.sep
  if (!resolved.startsWith(rootWithSep)) {
    throw new Error('Invalid path: outside system temp directory')
  }
  const rel = resolved.substring(rootWithSep.length)
  const firstSegment = rel.split(path.sep)[0] ?? ''
  if (!allowedPrefixes.some((p) => firstSegment.startsWith(p))) {
    throw new Error('Invalid path: not in an allowed temp subdirectory')
  }
  return resolved
}

/** Allowed prefix for git-related tmp directories. */
export const GIT_TMP_PREFIXES = ['testnizer-'] as const

const SYSTEM_DIR_PREFIXES = [
  '/etc',
  '/var',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/root',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\ProgramData',
]

/**
 * Validate a file path supplied by the renderer for the project-export
 * import flow (`save:importLocal`). The renderer is expected to pass the
 * path returned by the native file-open dialog, but we cannot trust it —
 * a compromised renderer could supply an arbitrary path.
 *
 * We require: absolute, .json extension, not inside a known system dir.
 * NOTE: this is for the *project export* importer only. Other importers
 * (OpenAPI/Postman/Insomnia/HAR/cURL) accept .yaml/.yml/.har/.proto/...
 * — if this validator is ever reused there, widen the extension list.
 */
export function assertImportFilePath(rawPath: string): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new Error('Invalid path: empty')
  }
  const resolved = path.resolve(rawPath)
  if (!path.isAbsolute(resolved)) {
    throw new Error('Invalid path: must be absolute')
  }
  if (!/\.json$/i.test(resolved)) {
    throw new Error('Invalid path: only .json files allowed')
  }
  for (const prefix of SYSTEM_DIR_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + path.sep)) {
      throw new Error('Invalid path: system directory not allowed')
    }
  }
  return resolved
}
