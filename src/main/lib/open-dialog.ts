/**
 * Native "Open file" pickers — ONE place for the macOS package rule.
 *
 * NSOpenPanel treats a folder whose name carries a filtered extension
 * (`certs.jks`, `client.p12`, `store.keystore`) as a document package: with
 * the extension filter active the user can neither open it nor navigate into
 * it (tester report, Keystore Studio → Open). `treatPackageAsDirectory` makes
 * the panel browse such folders like any other directory. It is a macOS-only
 * property; Windows / Linux ignore it.
 *
 * Every `showOpenDialog` that picks FILES goes through
 * {@link openFileDialogOptions}. Directory pickers (`openDirectory`) are left
 * alone. And because whether NSOpenPanel still lets a folder be *chosen* as
 * a file depends on the macOS version, the handlers that read the pick also
 * call {@link assertNotFolder} — a clear message instead of a raw `EISDIR`.
 */
import { statSync } from 'fs'
import { basename } from 'path'
import type { OpenDialogOptions } from 'electron'

/** Adds `treatPackageAsDirectory` to a file picker's properties. */
export function openFileDialogOptions<T extends OpenDialogOptions>(options: T): T {
  const properties = options.properties ?? []
  if (!properties.includes('openFile') || properties.includes('treatPackageAsDirectory')) {
    return options
  }
  return { ...options, properties: [...properties, 'treatPackageAsDirectory'] }
}

/** Text shown when a folder arrives where a file was expected. */
export function pickedFolderError(path: string, what = 'file'): string {
  return `"${basename(path)}" is a folder, not a file. Choose the ${what} inside it.`
}

/**
 * Throws {@link pickedFolderError} when `path` is a directory. A missing
 * path is left to the caller's own read (its error is already specific).
 */
export function assertNotFolder(path: string, what = 'file'): void {
  let isDir = false
  try {
    isDir = statSync(path).isDirectory()
  } catch {
    return
  }
  if (isDir) throw new Error(pickedFolderError(path, what))
}
