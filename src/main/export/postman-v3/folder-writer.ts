/**
 * Postman v3 collection document → a Native Git folder (issue #277).
 *
 * Layout (the Postman Local View / Native Git workspace layout, research
 * 01-formats §3.3), written into a NEW folder named after the project inside
 * the folder the user picked:
 *
 *   <picked>/<Project>/
 *     postman/collections/<Collection>/
 *       .resources/definition.yaml                      $kind: collection (+ auth, scripts, order)
 *       <Request>.request.yaml                          $kind: <kind>-request (+ order)
 *       .resources/<Request>.resources/examples/*.example.yaml
 *       .resources/<Request>.resources/messages/*.message.yaml
 *       <Folder>/.resources/definition.yaml
 *       <Folder>/<Request>.request.yaml
 *     postman/environments/<Environment>.environment.yaml
 *
 * The project variables are the collection's `variables` (in its
 * definition.yaml, issue #281); no workspace globals file is written.
 *
 * Arrays everywhere (schema form), `order` spaced by 1000 in document order,
 * `name:` written only when the file name had to differ from it. File names
 * follow FMT002 (no `/ \ : * ? " < > |`, no control characters) and FMT007
 * (case-insensitive collisions get " (2)", " (3)" …); Windows reserved stems
 * (CON, NUL, COM1 …) get a trailing "_".
 *
 * Nothing is overwritten: the tree is written into a temporary folder next to
 * the target and renamed into place; an existing `<Project>` folder gets a
 * " (2)" suffix instead.
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { Json } from './rows'

export interface V3EnvironmentOut {
  name: string
  values: Array<{ key: string; value: string; enabled: boolean; secret: boolean }>
}

export interface V3FolderBundle {
  /** Name of the folder created inside the picked one (the project). */
  rootName: string
  collection: Json
  environments: V3EnvironmentOut[]
}

interface JsYaml {
  dump: (v: unknown, o?: Record<string, unknown>) => string
}

function yaml(v: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const y = require('js-yaml') as JsYaml
  return y.dump(v, { lineWidth: -1, noRefs: true })
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_STEM = 120

/** A display name → a file / folder name Postman accepts on every OS. */
export function sanitizeFileStem(name: string): string {
  let s = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '_')
  if (s.length > MAX_STEM) s = s.slice(0, MAX_STEM).trim()
  if (!s) s = 'Untitled'
  if (RESERVED.test(s)) s += '_'
  return s
}

/** Unique stem among `taken` (case-insensitive); registers the result. */
export function uniqueStem(name: string, taken: Set<string>): string {
  const base = sanitizeFileStem(name)
  let stem = base
  for (let n = 2; taken.has(stem.toLowerCase()); n++) stem = `${base} (${n})`
  taken.add(stem.toLowerCase())
  return stem
}

const ORDER_STEP = 1000

interface PendingFile {
  rel: string
  text: string
}

function isRecord(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Split one collection document into files under `base` (a POSIX relative path). */
function collectionFiles(collection: Json, base: string, out: PendingFile[]): void {
  const writeLevel = (node: Json, dir: string, order: number | null): void => {
    const def: Json = { $kind: 'collection' }
    const dirName = dir.slice(dir.lastIndexOf('/') + 1)
    if (typeof node.name === 'string' && node.name !== dirName) def.name = node.name
    for (const k of ['description', 'variables', 'auth', 'scripts']) {
      if (node[k] !== undefined) def[k] = node[k]
    }
    if (order !== null) def.order = order
    out.push({ rel: `${dir}/.resources/definition.yaml`, text: yaml(def) })

    const dirs = new Set<string>()
    const stems = new Set<string>()
    const items = Array.isArray(node.items) ? node.items.filter(isRecord) : []
    items.forEach((item, i) => {
      const itemOrder = (i + 1) * ORDER_STEP
      if (item.$kind === 'collection') {
        const stem = uniqueStem(String(item.name ?? 'Folder'), dirs)
        writeLevel(item, `${dir}/${stem}`, itemOrder)
        return
      }
      const stem = uniqueStem(String(item.name ?? 'Request'), stems)
      const { examples, messages, ...rest } = item
      const doc: Json = { ...rest }
      if (doc.name === stem) delete doc.name
      const resDir = `.resources/${stem}.resources`
      const resources = (list: unknown, key: 'examples' | 'messages', suffix: string): void => {
        if (!Array.isArray(list) || list.length === 0) return
        doc[key] = `${resDir}/${key}`
        const taken = new Set<string>()
        list.filter(isRecord).forEach((r, j) => {
          const rStem = uniqueStem(String(r.name ?? key.slice(0, -1)), taken)
          const rDoc: Json = { ...r }
          if (rDoc.name === rStem) delete rDoc.name
          rDoc.order = (j + 1) * ORDER_STEP
          out.push({ rel: `${dir}/${resDir}/${key}/${rStem}.${suffix}.yaml`, text: yaml(rDoc) })
        })
      }
      resources(examples, 'examples', 'example')
      resources(messages, 'messages', 'message')
      doc.order = itemOrder
      out.push({ rel: `${dir}/${stem}.request.yaml`, text: yaml(doc) })
    })
  }
  writeLevel(collection, base, null)
}

function envDoc(env: V3EnvironmentOut): Json {
  return {
    name: env.name,
    values: env.values.map((v) => ({
      key: v.key,
      value: v.secret ? '' : v.value,
      enabled: v.enabled,
      type: v.secret ? 'secret' : 'default',
    })),
  }
}

/** Every file of the bundle, relative to the created root folder. */
export function bundleFiles(bundle: V3FolderBundle): PendingFile[] {
  const out: PendingFile[] = []
  const colStem = sanitizeFileStem(String(bundle.collection.name ?? bundle.rootName))
  collectionFiles(bundle.collection, `postman/collections/${colStem}`, out)
  const envStems = new Set<string>()
  for (const env of bundle.environments) {
    const stem = uniqueStem(env.name, envStems)
    out.push({ rel: `postman/environments/${stem}.environment.yaml`, text: yaml(envDoc(env)) })
  }
  return out
}

/**
 * Write the bundle into a new folder inside `parentDir`; returns the created
 * folder. Never overwrites: an existing name gets " (2)", " (3)" …
 */
export function writeV3Folder(parentDir: string, bundle: V3FolderBundle): string {
  const files = bundleFiles(bundle)
  const rootStem = sanitizeFileStem(bundle.rootName)
  let target = path.join(parentDir, rootStem)
  for (let n = 2; fs.existsSync(target); n++) target = path.join(parentDir, `${rootStem} (${n})`)
  const tmp = path.join(parentDir, `.testnizer-export-${randomUUID()}`)
  try {
    for (const f of files) {
      const abs = path.join(tmp, ...f.rel.split('/'))
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, f.text, { encoding: 'utf8', flag: 'wx' })
    }
    fs.renameSync(tmp, target)
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw e
  }
  return target
}
