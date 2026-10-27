/**
 * A .zip picked in the Import modal (issue #276 follow-up), read IN MEMORY:
 * nothing is ever extracted to disk. The archive is untrusted input; every
 * entry is checked before its bytes are read, and the whole archive is
 * refused on the first unsafe entry:
 *  - names: no absolute path or drive letter, no `..` segment, no backslash,
 *    no NUL, no empty / `.` segment, no duplicate (yauzl's own name check
 *    runs first, with `strictFileNames` so a backslash is never rewritten to
 *    `/` before it is checked);
 *  - no symbolic-link entry (unix mode `S_IFLNK` in the external attributes);
 *  - no encrypted entry;
 *  - limits (`V3_LIMITS`, the one owner): entry count, the archive's own size,
 *    uncompressed bytes per entry and in total, and the compression ratio of
 *    an entry (zip bomb). Declared sizes are checked before reading and yauzl
 *    (`validateEntrySizes`) fails a stream that inflates past its declared
 *    size; the bytes streamed are counted as well.
 *
 * What is inside is decided by `archive.ts`; this module only hands back the
 * file entries (`readZipEntries`) and turns them into an entry source for the
 * v3 folder reader (`zipSource`).
 */
import type { Readable } from 'stream'
import { isZipMagic } from '../../../shared/postman-detect'
import { V3InputError, V3_LIMITS } from './v3/safe-parse'
import type { V3EntrySource, V3SourceEntry } from './v3/folder-reader'

export interface ZipFileEntry {
  /** POSIX path inside the archive. */
  rel: string
  data: Buffer
}

export interface ZipLimits {
  maxEntries: number
  maxArchiveBytes: number
  maxEntryBytes: number
  maxTotalBytes: number
  maxCompressionRatio: number
  ratioCheckFromBytes: number
}

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: V3_LIMITS.maxEntries,
  maxArchiveBytes: V3_LIMITS.maxArchiveBytes,
  maxEntryBytes: V3_LIMITS.maxArchiveEntryBytes,
  maxTotalBytes: V3_LIMITS.maxArchiveTotalBytes,
  maxCompressionRatio: V3_LIMITS.maxCompressionRatio,
  ratioCheckFromBytes: V3_LIMITS.ratioCheckFromBytes,
}

// ── yauzl (CJS; the transitive @types/yauzl is for v2, so a local shape) ──
interface YauzlEntry {
  fileName: string
  compressedSize: number
  uncompressedSize: number
  externalFileAttributes: number
  isEncrypted(): boolean
}
interface YauzlZipFile {
  entryCount: number
  readEntry(): void
  close(): void
  on(event: 'entry', cb: (entry: YauzlEntry) => void): void
  on(event: 'end', cb: () => void): void
  on(event: 'error', cb: (err: Error) => void): void
  openReadStream(entry: YauzlEntry, cb: (err: Error | null, stream?: Readable) => void): void
}
interface Yauzl {
  fromBuffer(
    buffer: Buffer,
    options: { lazyEntries: boolean; validateEntrySizes: boolean; strictFileNames: boolean },
    cb: (err: Error | null, zip?: YauzlZipFile) => void,
  ): void
}
function yauzl(): Yauzl {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('yauzl') as Yauzl
}

const MB = (n: number): string => `${Math.round(n / 1024 / 1024)} MB`

const refused = (detail: string): V3InputError =>
  new V3InputError(`The .zip archive was refused: ${detail}`)

/** Why an entry name is unsafe, or null. */
function unsafeName(name: string): string | null {
  if (name.includes('\0')) return 'contains a NUL character'
  if (name.includes('\\')) return 'contains a backslash'
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return 'is an absolute path'
  const segments = name.replace(/\/$/, '').split('/')
  if (segments.includes('..')) return 'climbs out of the archive with ".."'
  if (segments.some((s) => s === '' || s === '.')) return 'has an empty or "." path segment'
  return null
}

/** yauzl's own errors → the same user-facing wording. */
function fromYauzlError(e: Error): V3InputError {
  if (e instanceof V3InputError) return e
  const m = e.message
  const name = m.slice(m.indexOf(':') + 1).trim()
  if (/^invalid relative path/.test(m))
    return refused(`the entry "${name}" climbs out of the archive with "..".`)
  if (/^absolute path/.test(m)) return refused(`the entry "${name}" is an absolute path.`)
  if (/^invalid characters in fileName/.test(m))
    return refused(`the entry "${name}" contains a backslash.`)
  if (/compression method/.test(m))
    return refused('an entry uses an unsupported compression method.')
  if (/size mismatch|too many bytes|not enough bytes|uncompressedSize/i.test(m))
    return refused(
      "an entry's size does not match the archive's directory (damaged or crafted archive).",
    )
  if (/end of central directory|central directory|signature/i.test(m))
    return new V3InputError(
      'The file is not a readable .zip archive (it is damaged or incomplete).',
    )
  return new V3InputError(`The .zip archive could not be read (${m}).`)
}

/** Archive-tool leftovers that are never content: macOS `__MACOSX/`, `.DS_Store`, AppleDouble `._*`. */
function isArchiveJunk(rel: string): boolean {
  if (rel === '__MACOSX' || rel.startsWith('__MACOSX/')) return true
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  return base === '.DS_Store' || base.startsWith('._')
}

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

/**
 * Every file entry of a .zip (folder entries dropped, archive-tool leftovers
 * dropped), in archive order. Throws `V3InputError` with a user-facing
 * message for anything unsafe or over a limit.
 */
export async function readZipEntries(
  buffer: Buffer,
  limits: ZipLimits = ZIP_LIMITS,
): Promise<ZipFileEntry[]> {
  if (buffer.length > limits.maxArchiveBytes) {
    throw refused(`the file is larger than ${MB(limits.maxArchiveBytes)}.`)
  }
  if (!isZipMagic(buffer)) throw new V3InputError('The file is not a .zip archive.')
  const zip = await new Promise<YauzlZipFile>((resolve, reject) => {
    yauzl().fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, z) => (err || !z ? reject(fromYauzlError(err ?? new Error('no archive'))) : resolve(z)),
    )
  })
  try {
    if (zip.entryCount > limits.maxEntries) {
      throw refused(`it holds more than ${limits.maxEntries} entries.`)
    }
    return await new Promise<ZipFileEntry[]>((resolve, reject) => {
      const out: ZipFileEntry[] = []
      const seen = new Set<string>()
      let count = 0
      let total = 0
      let settled = false
      const fail = (e: unknown): void => {
        if (settled) return
        settled = true
        reject(e instanceof Error ? fromYauzlError(e) : new V3InputError(String(e)))
      }
      zip.on('error', fail)
      zip.on('end', () => {
        if (settled) return
        settled = true
        resolve(out)
      })
      zip.on('entry', (entry) => {
        if (settled) return
        try {
          const name = entry.fileName
          count++
          if (count > limits.maxEntries) {
            throw refused(`it holds more than ${limits.maxEntries} entries.`)
          }
          const why = unsafeName(name)
          if (why) throw refused(`the entry "${name}" ${why}.`)
          const key = name.replace(/\/$/, '')
          if (seen.has(key)) throw refused(`the entry "${key}" appears twice.`)
          seen.add(key)
          if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) {
            throw refused(`the entry "${name}" is a symbolic link.`)
          }
          if (entry.isEncrypted()) {
            throw refused(
              `the entry "${name}" is encrypted (password-protected archives are not supported).`,
            )
          }
          if (name.endsWith('/') || isArchiveJunk(key)) {
            zip.readEntry()
            return
          }
          const size = entry.uncompressedSize
          if (size > limits.maxEntryBytes) {
            throw refused(
              `the entry "${name}" is larger than ${MB(limits.maxEntryBytes)} uncompressed.`,
            )
          }
          total += size
          if (total > limits.maxTotalBytes) {
            throw refused(
              `its entries add up to more than ${MB(limits.maxTotalBytes)} uncompressed.`,
            )
          }
          if (
            size > limits.ratioCheckFromBytes &&
            size / Math.max(entry.compressedSize, 1) > limits.maxCompressionRatio
          ) {
            throw refused(
              `the entry "${name}" expands more than ${limits.maxCompressionRatio} times (a zip bomb?).`,
            )
          }
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) return fail(err ?? new Error('no stream'))
            const chunks: Buffer[] = []
            let read = 0
            stream.on('data', (chunk: Buffer) => {
              if (settled) return
              read += chunk.length
              if (read > size) {
                stream.destroy()
                fail(refused(`the entry "${name}" inflates past its declared size.`))
                return
              }
              chunks.push(chunk)
            })
            stream.on('error', fail)
            stream.on('end', () => {
              if (settled) return
              out.push({ rel: key, data: Buffer.concat(chunks) })
              zip.readEntry()
            })
          })
        } catch (e) {
          fail(e)
        }
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
}

/**
 * The entries of a zipped folder usually sit under one top folder (the
 * folder that was compressed): read them as if that folder had been picked.
 * Not when that folder is `.resources` (a collection zipped from inside).
 */
export function unwrapSingleTopFolder(files: ZipFileEntry[]): ZipFileEntry[] {
  if (files.length === 0) return files
  const tops = new Set(files.map((f) => (f.rel.includes('/') ? f.rel.split('/')[0] : null)))
  if (tops.size !== 1) return files
  const top = [...tops][0]
  if (top === null || top === '.resources') return files
  return files.map((f) => ({ ...f, rel: f.rel.slice(top.length + 1) }))
}

/** File entries → an entry source for the v3 folder reader (folders synthesised from the paths). */
export function zipSource(files: ZipFileEntry[]): V3EntrySource {
  const byRel = new Map<string, ZipFileEntry>()
  const kids = new Map<string, Map<string, 'dir' | 'file'>>([['', new Map()]])
  for (const f of files) {
    const segments = f.rel.split('/')
    let parent = ''
    for (let i = 0; i < segments.length; i++) {
      const rel = parent ? `${parent}/${segments[i]}` : segments[i]
      const last = i === segments.length - 1
      const siblings = kids.get(parent)
      if (!siblings) break // a file where a folder was expected: not reachable
      if (!siblings.has(segments[i])) {
        siblings.set(segments[i], last ? 'file' : 'dir')
        if (!last) kids.set(rel, new Map())
      }
      if (last && siblings.get(segments[i]) === 'file') byRel.set(rel, f)
      parent = rel
    }
  }
  return {
    walk(report) {
      const visit = (dir: string): void => {
        const list = [...(kids.get(dir) ?? new Map<string, 'dir' | 'file'>()).entries()].sort(
          ([a], [b]) => a.localeCompare(b),
        )
        for (const [name, kind] of list) {
          const rel = dir ? `${dir}/${name}` : name
          const e: V3SourceEntry =
            kind === 'dir'
              ? { rel, kind: 'dir', size: 0 }
              : { rel, kind: 'file', size: byRel.get(rel)?.data.length ?? 0 }
          if (report(e) && kind === 'dir') visit(rel)
        }
      }
      visit('')
    },
    read(rel) {
      const f = byRel.get(rel)
      if (!f) throw new V3InputError(`"${rel}" is not a file in the archive.`)
      return f.data
    },
  }
}
