/**
 * Postman v3 Native Git folder → in-memory v3 documents (issue #276 part 2).
 *
 * Accepts the folder the user picked in the Import modal:
 *  - a COLLECTION folder: `.resources/definition.yaml` and / or
 *    `*.request.yaml` files (sub-folders are folders);
 *  - a WORKSPACE folder: `postman/collections/<name>/…` (or `collections/`
 *    at the top), `environments/*.environment.yaml`,
 *    `globals/*.globals.yaml`. Everything else Native Git keeps there
 *    (specs, flows, mocks, datasets, documents, `.postman/`) is reported as
 *    found and not imported.
 *
 * The result is MONOLITH-SHAPED: each collection is one `{ $kind:
 * 'collection', name, items: […] }` document — the shape the public v3 JSON
 * Schema describes — so a v3 JSON file and a folder go through the same
 * mapper (`to-v2.ts`). Siblings are ordered by `order` (no order → last,
 * then by name); a request's `examples:` / `messages:` path is replaced by
 * the parsed resource files; a path-backed script (`src:`) by its code.
 *
 * The same reader takes a zipped folder (`../zip.ts`): a folder on disk and
 * the entries of a .zip are two `V3EntrySource`s; the checks and limits below
 * are applied once, here, to both.
 *
 * Safety (the folder is untrusted input):
 *  - symbolic links are never followed (lstat) and are reported;
 *  - every path is resolved with realpath and must stay inside the picked
 *    folder — a script `src: ../../outside.js` is refused;
 *  - caps on entries, files, bytes per file, total bytes and depth
 *    (`V3_LIMITS`); YAML goes through `parseYamlSafe` (CORE schema + bounded
 *    walk);
 *  - only `.yaml` / `.yml` files and referenced scripts are read; any other
 *    file is listed in the report, never opened.
 *
 * Everything is read BEFORE the import transaction starts (better-sqlite3
 * transactions are synchronous).
 */
import fs from 'fs'
import path from 'path'
import { V3InputError, V3_LIMITS, parseYamlSafe } from './safe-parse'

type Doc = Record<string, unknown>

const isRecord = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v)

export interface V3EnvironmentFile {
  /** Path relative to the picked folder (for the report). */
  rel: string
  doc: Doc
}

export interface V3FolderCollection {
  rel: string
  doc: Doc
}

export interface V3FolderContent {
  kind: 'workspace' | 'collection'
  collections: V3FolderCollection[]
  environments: V3EnvironmentFile[]
  globals: V3EnvironmentFile[]
  /** Files / folders that were found and deliberately not imported. */
  ignored: string[]
  warnings: string[]
}

interface Entry {
  /** POSIX path relative to the root. */
  rel: string
  dir: boolean
  size: number
}

/** One file or folder an entry source reports; `rel` is a POSIX path relative to the root. */
export interface V3SourceEntry {
  rel: string
  kind: 'dir' | 'file' | 'symlink' | 'other'
  /** Bytes of a file (0 for anything else). */
  size: number
}

/**
 * Where a v3 tree comes from: a picked folder on disk (`folderSource`) or the
 * entries of a .zip read in memory (`../zip.ts`). The `Reader` below is the
 * ONE owner of the entry map, the checks on paths written inside YAML files
 * and every count / size / depth limit (`V3_LIMITS`); a source only lists
 * entries and returns bytes.
 *
 * `walk` reports every entry, a folder before its contents; the callback
 * returns false for a folder that must not be descended. `read` returns one
 * scanned regular file's bytes, after the `Reader` has checked the caps.
 */
export interface V3EntrySource {
  walk(report: (e: V3SourceEntry) => boolean): void
  read(rel: string): Buffer
}

/** A picked folder on disk. Symbolic links are reported, never followed; a read must stay inside the folder. */
export function folderSource(root: string): V3EntrySource {
  let st: fs.Stats
  try {
    st = fs.lstatSync(root)
  } catch (e) {
    throw new V3InputError(`Cannot open the folder: ${(e as Error).message}`)
  }
  if (st.isSymbolicLink()) throw new V3InputError('The picked folder is a symbolic link.')
  if (!st.isDirectory()) throw new V3InputError('The picked path is not a folder.')
  const realRoot = fs.realpathSync(root)
  return {
    walk(report) {
      const walkDir = (absDir: string, relDir: string): void => {
        for (const d of fs.readdirSync(absDir, { withFileTypes: true })) {
          const rel = relDir ? `${relDir}/${d.name}` : d.name
          const abs = path.join(absDir, d.name)
          const ls = fs.lstatSync(abs)
          const kind: V3SourceEntry['kind'] = ls.isSymbolicLink()
            ? 'symlink'
            : ls.isDirectory()
              ? 'dir'
              : ls.isFile()
                ? 'file'
                : 'other'
          const descend = report({ rel, kind, size: kind === 'file' ? ls.size : 0 })
          if (kind === 'dir' && descend) walkDir(abs, rel)
        }
      }
      walkDir(root, '')
    },
    read(rel) {
      const real = fs.realpathSync(path.join(root, ...rel.split('/')))
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
        throw new V3InputError(`"${rel}" resolves outside the picked folder.`)
      }
      return fs.readFileSync(real)
    },
  }
}

const SKIP_DIRS = new Set(['.git', 'node_modules'])

/** Natural sort key: `order` first (missing → last), then the name. */
export function compareByOrder(
  a: { order?: unknown; sortName: string },
  b: { order?: unknown; sortName: string },
): number {
  const oa = typeof a.order === 'number' && Number.isFinite(a.order) ? a.order : null
  const ob = typeof b.order === 'number' && Number.isFinite(b.order) ? b.order : null
  if (oa !== null && ob !== null && oa !== ob) return oa - ob
  if (oa !== null && ob === null) return -1
  if (oa === null && ob !== null) return 1
  return a.sortName.localeCompare(b.sortName)
}

const REQUEST_RE = /\.request\.ya?ml$/i
const EXAMPLE_RE = /\.example\.ya?ml$/i
const MESSAGE_RE = /\.message\.ya?ml$/i
const ENV_RE = /\.environment\.ya?ml$/i
const GLOBALS_RE = /\.globals\.ya?ml$/i
const YAML_RE = /\.ya?ml$/i

class Reader {
  readonly entries = new Map<string, Entry>()
  readonly children = new Map<string, Entry[]>()
  readonly consumed = new Set<string>()
  readonly warnings: string[] = []
  readonly ignored: string[] = []
  private filesRead = 0
  private bytesRead = 0

  constructor(private readonly source: V3EntrySource) {}

  scan(): void {
    let count = 0
    this.children.set('', [])
    this.source.walk((se) => {
      count++
      if (count > V3_LIMITS.maxEntries) {
        throw new V3InputError(
          `The folder holds more than ${V3_LIMITS.maxEntries} files and folders; pick a single collection or workspace folder.`,
        )
      }
      if (se.kind === 'symlink') {
        this.warnings.push(`"${se.rel}" is a symbolic link and was not followed.`)
        return false
      }
      if (se.kind === 'other') return false
      const dir = se.kind === 'dir'
      if (dir) {
        if (SKIP_DIRS.has(baseOf(se.rel))) {
          this.ignored.push(`${se.rel}/`)
          return false
        }
        if (se.rel.split('/').length > V3_LIMITS.maxDirDepth) {
          throw new V3InputError(
            `The folder is nested deeper than ${V3_LIMITS.maxDirDepth} levels (${se.rel}).`,
          )
        }
      }
      // A source reports a folder before its contents: no known parent (a
      // skipped folder) or a second report of the same path → not taken.
      const siblings = this.children.get(dirOf(se.rel))
      if (!siblings || this.entries.has(se.rel)) return false
      const e: Entry = { rel: se.rel, dir, size: dir ? 0 : se.size }
      this.entries.set(se.rel, e)
      siblings.push(e)
      if (dir) this.children.set(se.rel, [])
      return true
    })
    // Name order, whichever order the disk or the archive listed them in.
    const byName = (a: Entry, b: Entry): number => baseOf(a.rel).localeCompare(baseOf(b.rel))
    for (const list of this.children.values()) list.sort(byName)
  }

  list(relDir: string): Entry[] {
    return this.children.get(relDir) ?? []
  }

  isDir(rel: string): boolean {
    return this.entries.get(rel)?.dir === true
  }

  /** Read one file's text within the caps; `rel` must be a scanned regular file. */
  readText(rel: string): string {
    const e = this.entries.get(rel)
    if (!e || e.dir) throw new V3InputError(`"${rel}" is not a file in the picked folder.`)
    if (e.size > V3_LIMITS.maxFileBytes) {
      throw new V3InputError(
        `"${rel}" is larger than ${Math.round(V3_LIMITS.maxFileBytes / 1024 / 1024)} MB.`,
      )
    }
    this.filesRead++
    if (this.filesRead > V3_LIMITS.maxFiles) {
      throw new V3InputError(`The folder holds more than ${V3_LIMITS.maxFiles} Postman files.`)
    }
    this.bytesRead += e.size
    if (this.bytesRead > V3_LIMITS.maxTotalBytes) {
      throw new V3InputError(
        `The folder holds more than ${Math.round(V3_LIMITS.maxTotalBytes / 1024 / 1024)} MB of Postman files.`,
      )
    }
    this.consumed.add(rel)
    return this.source.read(rel).toString('utf8')
  }

  readYaml(rel: string): unknown {
    return parseYamlSafe(this.readText(rel), rel)
  }

  /**
   * A path written inside a YAML file (`src:`, `examples:`, `messages:`),
   * relative to that file's folder → a scanned root-relative path, or null
   * when it leaves the collection root (FMT012) or does not exist.
   */
  resolveRef(fromDirRel: string, ref: string, collectionRootRel: string): string | null {
    if (typeof ref !== 'string' || !ref.trim() || ref.includes('\0')) return null
    if (path.posix.isAbsolute(ref) || /^[a-zA-Z]:[\\/]/.test(ref)) return null
    const joined = path.posix.normalize(path.posix.join(fromDirRel || '.', ref.replace(/\\/g, '/')))
    // Only a lone "." or a "./" prefix — never the dot of a ".resources" name
    // (a request at the picked folder's root has `fromDirRel` "").
    const trimmed = joined.replace(/\/+$/, '')
    const rel = trimmed === '.' ? '' : trimmed.replace(/^\.\//, '')
    if (rel === '..' || rel.startsWith('../')) return null
    const inside =
      collectionRootRel === '' ||
      rel === collectionRootRel ||
      rel.startsWith(collectionRootRel + '/')
    if (!inside) return null
    return this.entries.has(rel) ? rel : null
  }
}

const dirOf = (rel: string): string => {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}
const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

/**
 * Script entries: `src:` read from the folder (inside the collection), else
 * dropped with a warning. A request's `src` is relative to the request file's
 * folder; a folder definition's to the folder it describes (`baseDirs` lists
 * the folders tried, in order).
 */
function resolveScripts(
  r: Reader,
  scripts: unknown,
  fileRel: string,
  collectionRoot: string,
  baseDirs: string[] = [dirOf(fileRel)],
): unknown {
  if (!Array.isArray(scripts)) return scripts
  const out: unknown[] = []
  for (const s of scripts) {
    if (!isRecord(s)) continue
    if (typeof s.code === 'string' || s.src === undefined) {
      out.push(s)
      continue
    }
    const target =
      baseDirs
        .map((d) => r.resolveRef(d, String(s.src), collectionRoot))
        .find((t) => t !== null && !r.isDir(t)) ?? null
    if (!target) {
      r.warnings.push(
        `"${fileRel}": the ${String(s.type ?? '')} script file "${String(s.src)}" is outside the collection folder or missing; the script was not imported.`,
      )
      continue
    }
    try {
      const { src: _src, ...rest } = s
      void _src
      out.push({ ...rest, code: r.readText(target) })
    } catch (e) {
      if (e instanceof V3InputError) throw e
      r.warnings.push(`"${fileRel}": the script file "${String(s.src)}" could not be read.`)
    }
  }
  return out
}

/** `examples:` / `messages:` of a request: an inline list, a relative folder path, or the conventional folder. */
function readResources(
  r: Reader,
  doc: Doc,
  key: 'examples' | 'messages',
  fileRel: string,
  stem: string,
  collectionRoot: string,
): unknown[] | undefined {
  const raw = doc[key]
  if (Array.isArray(raw)) return raw
  const dir = dirOf(fileRel)
  let folder: string | null = null
  if (typeof raw === 'string') {
    folder = r.resolveRef(dir, raw, collectionRoot)
    if (!folder || !r.isDir(folder)) {
      r.warnings.push(
        `"${fileRel}": the ${key} folder "${raw}" is outside the collection folder or missing; its ${key} were not imported.`,
      )
      return undefined
    }
  } else {
    const conventional = join(dir, `.resources/${stem}.resources/${key}`)
    if (r.isDir(conventional)) folder = conventional
  }
  if (!folder) return undefined
  const re = key === 'examples' ? EXAMPLE_RE : MESSAGE_RE
  const found: Array<{ doc: Doc; order?: unknown; sortName: string }> = []
  for (const e of r.list(folder)) {
    if (e.dir || !re.test(e.rel)) continue
    const parsed = r.readYaml(e.rel)
    if (!isRecord(parsed)) continue
    const fileStem = baseOf(e.rel).replace(re, '')
    const named =
      typeof parsed.name === 'string' && parsed.name.trim() ? parsed : { ...parsed, name: fileStem }
    found.push({ doc: named, order: parsed.order, sortName: fileStem })
  }
  found.sort(compareByOrder)
  return found.map((f) => f.doc)
}

/** One collection folder (definition optional) → a monolith-shaped collection document. */
function readCollectionDir(r: Reader, rootRel: string): Doc {
  const build = (dirRel: string, isRoot: boolean): Doc | null => {
    const defRel = join(dirRel, '.resources/definition.yaml')
    const defRelYml = join(dirRel, '.resources/definition.yml')
    let def: Doc = {}
    const defPath = r.entries.has(defRel) ? defRel : r.entries.has(defRelYml) ? defRelYml : null
    if (defPath) {
      const parsed = r.readYaml(defPath)
      if (isRecord(parsed)) {
        if (parsed.$kind !== undefined && parsed.$kind !== 'collection') {
          r.warnings.push(
            `"${defPath}": $kind "${String(parsed.$kind)}" is not "collection"; read as a folder definition.`,
          )
        }
        def = {
          ...parsed,
          scripts: resolveScripts(r, parsed.scripts, defPath, rootRel, [dirRel, dirOf(defPath)]),
        }
      }
    }
    const kids: Array<{ doc: Doc; order?: unknown; sortName: string }> = []
    const resourceStems = new Set<string>()
    for (const e of r.list(dirRel)) {
      const name = baseOf(e.rel)
      if (e.dir) {
        if (name === '.resources') continue
        const sub = build(e.rel, false)
        if (sub) kids.push({ doc: sub, order: sub.order, sortName: name })
        continue
      }
      if (!REQUEST_RE.test(name)) continue
      const stem = name.replace(REQUEST_RE, '')
      resourceStems.add(stem)
      const parsed = r.readYaml(e.rel)
      if (!isRecord(parsed)) {
        r.warnings.push(`"${e.rel}": not a request document; skipped.`)
        continue
      }
      const req: Doc = {
        ...parsed,
        name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : stem,
        scripts: resolveScripts(r, parsed.scripts, e.rel, rootRel),
      }
      const examples = readResources(r, parsed, 'examples', e.rel, stem, rootRel)
      if (examples) req.examples = examples
      else delete req.examples
      const messages = readResources(r, parsed, 'messages', e.rel, stem, rootRel)
      if (messages) req.messages = messages
      else delete req.messages
      if (req.scripts === undefined) delete req.scripts
      kids.push({ doc: req, order: parsed.order, sortName: stem })
    }
    // FMT011: a `.resources/<name>.resources/` folder without its request.
    const resDir = join(dirRel, '.resources')
    for (const e of r.list(resDir)) {
      if (!e.dir) continue
      const m = /^(.*)\.resources$/.exec(baseOf(e.rel))
      if (m && !resourceStems.has(m[1])) r.ignored.push(`${e.rel}/ (no matching request)`)
    }
    if (!isRoot && !defPath && kids.length === 0) return null
    kids.sort(compareByOrder)
    const folderName = baseOf(dirRel) || 'Collection'
    const out: Doc = {
      ...def,
      $kind: 'collection',
      name: typeof def.name === 'string' && def.name.trim() ? def.name : folderName,
      items: kids.map((k) => k.doc),
    }
    if (out.scripts === undefined) delete out.scripts
    return out
  }
  return build(rootRel, true) ?? { $kind: 'collection', name: baseOf(rootRel), items: [] }
}

/** Does this folder (recursively) look like a v3 collection root? */
function looksLikeCollection(r: Reader, dirRel: string): boolean {
  if (r.entries.has(join(dirRel, '.resources/definition.yaml'))) return true
  if (r.entries.has(join(dirRel, '.resources/definition.yml'))) return true
  const prefix = dirRel ? dirRel + '/' : ''
  for (const rel of r.entries.keys()) {
    if (rel.startsWith(prefix) && REQUEST_RE.test(rel)) return true
  }
  return false
}

const WORKSPACE_SIDE_DIRS = new Set([
  'specs',
  'flows',
  'mocks',
  'datasets',
  'documents',
  'sdks',
  'docs',
])

export const NOT_V3_FOLDER_MESSAGE =
  'This folder is not a Postman v3 collection or workspace: it has no ".resources/definition.yaml", no "*.request.yaml" files and no "postman/collections" folder.'

/** Read a picked folder. Throws `V3InputError` for an unusable folder. */
export function readV3Folder(root: string): V3FolderContent {
  const content = readV3Source(folderSource(root))
  if (!content) throw new V3InputError(NOT_V3_FOLDER_MESSAGE)
  return content
}

/**
 * Read a v3 tree from any entry source. Null when the tree is not a Postman
 * v3 collection or workspace at all; throws `V3InputError` for one that is
 * but cannot be used (limits, an empty workspace, unsafe references).
 */
export function readV3Source(source: V3EntrySource): V3FolderContent | null {
  const r = new Reader(source)
  r.scan()

  // Workspace base: `postman/` (Native Git) or the picked folder itself when it
  // holds `collections/` (a copy of that folder's content).
  let base: string | null = null
  if (
    r.isDir('postman/collections') ||
    r.isDir('postman/environments') ||
    r.isDir('postman/globals')
  ) {
    base = 'postman'
  } else if (
    r.isDir('collections') &&
    !looksLikeCollectionAtTop(r) &&
    r.list('collections').some((e) => e.dir && looksLikeCollection(r, e.rel))
  ) {
    base = ''
  } else if ((r.isDir('environments') || r.isDir('globals')) && !looksLikeCollectionAtTop(r)) {
    base = ''
  }

  const out: V3FolderContent = {
    kind: base === null ? 'collection' : 'workspace',
    collections: [],
    environments: [],
    globals: [],
    ignored: r.ignored,
    warnings: r.warnings,
  }

  if (base === null) {
    if (!looksLikeCollection(r, '')) return null
    out.collections.push({ rel: '', doc: readCollectionDir(r, '') })
  } else {
    const colDir = join(base, 'collections')
    for (const e of r.list(colDir)) {
      if (e.dir && looksLikeCollection(r, e.rel)) {
        out.collections.push({ rel: e.rel, doc: readCollectionDir(r, e.rel) })
      } else if (!e.dir && /\.json$/i.test(e.rel)) {
        r.ignored.push(`${e.rel} (a JSON collection: import it with "Select file")`)
      }
    }
    for (const e of r.list(join(base, 'environments'))) {
      if (e.dir || !(ENV_RE.test(e.rel) || (YAML_RE.test(e.rel) && !GLOBALS_RE.test(e.rel))))
        continue
      const doc = r.readYaml(e.rel)
      if (isRecord(doc)) out.environments.push({ rel: e.rel, doc })
    }
    for (const e of r.list(join(base, 'globals'))) {
      if (e.dir || !YAML_RE.test(e.rel)) continue
      const doc = r.readYaml(e.rel)
      if (isRecord(doc)) out.globals.push({ rel: e.rel, doc })
    }
    // Native Git side content: listed, not imported.
    for (const e of r.list(base)) {
      const name = baseOf(e.rel)
      if (e.dir && WORKSPACE_SIDE_DIRS.has(name)) r.ignored.push(`${e.rel}/`)
    }
    if (r.isDir('.postman')) r.ignored.push('.postman/')
    if (out.collections.length === 0 && out.environments.length === 0 && out.globals.length === 0) {
      throw new V3InputError(
        'This Postman workspace folder holds no collections, environments or globals.',
      )
    }
  }

  // Every other file under the picked folder: found, not opened.
  const listedDirs = r.ignored.filter((x) => x.endsWith('/')).map((x) => x.slice(0, -1))
  for (const rel of [...r.entries.keys()].sort()) {
    if (r.entries.get(rel)?.dir || r.consumed.has(rel)) continue
    if (listedDirs.some((d) => rel.startsWith(d + '/'))) continue
    if (rel.startsWith('.postman/')) continue
    r.ignored.push(rel)
  }
  return out
}

/** A collection folder picked directly that happens to contain a `collections/` sub-folder. */
function looksLikeCollectionAtTop(r: Reader): boolean {
  if (r.entries.has('.resources/definition.yaml') || r.entries.has('.resources/definition.yml'))
    return true
  return r.list('').some((e) => !e.dir && REQUEST_RE.test(e.rel))
}
