/**
 * Reading a spec for a mock server: what is this file, and is there anything in
 * it to mock? Answered before a server exists, so a wrong file costs nothing.
 * The real import stays in main (`src/main/mock/importers.ts`); this only looks.
 */
import { createElement } from 'react'
import yaml from 'js-yaml'
import {
  assertTextBounded,
  InputDocumentError,
  MAX_IMPORT_BYTES,
} from '../../../shared/bounded-document'
import { openApiProblem } from '../../../shared/openapi-detect'
import { classifyPostmanDocument } from '../../../shared/postman-detect'
import { t } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import { toast } from '../../lib/toast'
import MockImportToast from './MockImportToast'

export type MockImportFormat = 'openapi' | 'postman'

export interface MockImportFile {
  format: MockImportFormat
  text: string
  fileName: string
  /** The spec's title, else the file name without its extension. */
  title: string
  /** What the file promises; the import's own count is what gets reported. */
  endpointCount: number
}

export interface MockImportResult {
  ok: boolean
  endpointsCreated: number
  responsesCreated: number
  warnings: string[]
  error?: string
}

export type MockImportInspection = { ok: true; file: MockImportFile } | { ok: false; error: string }

export const MOCK_IMPORT_ACCEPT = '.json,.yaml,.yml'
export const MOCK_IMPORT_MAX_BYTES = MAX_IMPORT_BYTES
const TITLE_MAX = 80
const REPORT_TOAST_ID = 'mock-import-report'
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)

function titleOf(named: unknown, fileName: string): string {
  const title = typeof named === 'string' ? named.trim() : ''
  return (title || fileName.replace(/\.[^.]+$/, '')).slice(0, TITLE_MAX)
}

/** A `$ref` path item counts as one: only main can follow it. */
function countOpenApiOperations(paths: unknown): number {
  if (!isRec(paths)) return 0
  let count = 0
  for (const item of Object.values(paths)) {
    if (!isRec(item)) continue
    if (typeof item.$ref === 'string') count += 1
    else count += Object.keys(item).filter((k) => HTTP_METHODS.has(k)).length
  }
  return count
}

function countPostmanRequests(items: unknown): number {
  if (!Array.isArray(items)) return 0
  let count = 0
  for (const it of items) {
    if (!isRec(it)) continue
    if (it.item) count += countPostmanRequests(it.item)
    else if (it.request) count += 1
  }
  return count
}

/** Only HTTP requests become endpoints; the kinds a mock cannot answer are not promised. */
function countV3Requests(items: unknown): number {
  if (!Array.isArray(items)) return 0
  let count = 0
  for (const it of items) {
    if (!isRec(it)) continue
    if (it.$kind === 'http-request') count += 1
    else if (Array.isArray(it.items)) count += countV3Requests(it.items)
  }
  return count
}

/** A collection's title and size by version; null for a Postman file that is no collection. */
function postmanCollection(kind: string, root: Rec): { name: unknown; count: number } | null {
  if (kind === 'v2-collection') {
    const name = isRec(root.info) ? root.info.name : undefined
    return { name, count: countPostmanRequests(root.item) }
  }
  if (kind === 'v1-collection') {
    const count = Array.isArray(root.requests) ? root.requests.length : 0
    return { name: root.name, count }
  }
  if (kind === 'v3-collection') return { name: root.name, count: countV3Requests(root.items) }
  return null
}

function parse(text: string): { root: unknown } | null {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    try {
      root = yaml.load(text)
    } catch (e) {
      // js-yaml recurses: deep nesting overflows inside `load`.
      if (e instanceof RangeError) throw e
      return null
    }
  }
  // Before any walk: a YAML alias costs one line and a walker's whole subtree.
  assertTextBounded(root, text, 'File')
  return { root }
}

export function inspectMockImportText(text: string, fileName: string): MockImportInspection {
  try {
    return inspect(text, fileName)
  } catch (e) {
    const tooComplex = e instanceof InputDocumentError || e instanceof RangeError
    return {
      ok: false,
      error: t(tooComplex ? 'mockNew.importTooComplex' : 'mockNew.importUnreadable'),
    }
  }
}

function inspect(text: string, fileName: string): MockImportInspection {
  const parsed = parse(text)
  if (!parsed || !isRec(parsed.root)) return { ok: false, error: t('mockNew.importNotRecognised') }
  const { root } = parsed

  const postman = classifyPostmanDocument(root)
  if (postman) {
    const collection = postmanCollection(postman.kind, root)
    if (!collection) return { ok: false, error: t('mockNew.importUnsupportedPostman') }
    if (collection.count === 0) return { ok: false, error: t('mockNew.importEmpty') }
    const title = titleOf(collection.name, fileName)
    return {
      ok: true,
      file: { format: 'postman', text, fileName, title, endpointCount: collection.count },
    }
  }

  if (root.openapi === undefined && root.swagger === undefined && root.paths === undefined) {
    return { ok: false, error: t('mockNew.importNotRecognised') }
  }
  const problem = openApiProblem(root)
  if (problem === 'not-openapi') return { ok: false, error: t('mockNew.importNoVersion') }
  if (problem === 'unsupported-version') {
    return { ok: false, error: t('mockNew.importUnsupportedVersion') }
  }
  if (problem) return { ok: false, error: t('mockNew.importEmpty') }
  const endpointCount = countOpenApiOperations(root.paths)
  if (endpointCount === 0) return { ok: false, error: t('mockNew.importEmpty') }
  const title = titleOf(isRec(root.info) ? root.info.title : undefined, fileName)
  return { ok: true, file: { format: 'openapi', text, fileName, title, endpointCount } }
}

export async function readMockImportFile(file: File): Promise<MockImportInspection> {
  if (file.size > MOCK_IMPORT_MAX_BYTES) return { ok: false, error: t('mockNew.importTooLarge') }
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, error: t('mockNew.importUnreadable') }
  }
  return inspectMockImportText(text, file.name)
}

/** Why this import result is not a success, or null. Nothing created is a failure. */
export function mockImportProblem(result: MockImportResult): string | null {
  if (!result.ok) return result.error ?? ''
  return result.endpointsCreated === 0 ? t('mockNew.importEmpty') : null
}

/** The one report of a finished import, for the dialog and the Endpoints tab alike. */
export function toastMockImportResult(result: MockImportResult): void {
  const problem = mockImportProblem(result)
  if (problem !== null) {
    toast.error(problem ? `${t('mock.importFailed')}: ${problem}` : t('mock.importFailed'))
    return
  }
  const endpoints = formatCount(
    result.endpointsCreated,
    t('mock.importEndpointCountOne'),
    t('mock.importEndpointCount'),
  )
  const responses = formatCount(
    result.responsesCreated,
    t('mock.importResponseCountOne'),
    t('mock.importResponseCount'),
  )
  const summary = t('mock.importDone', { endpoints, responses })
  if (result.warnings.length === 0) {
    toast.success(summary)
    return
  }
  toast.custom(
    () =>
      createElement(MockImportToast, {
        summary,
        warnings: result.warnings,
        onClose: () => toast.dismiss(REPORT_TOAST_ID),
      }),
    { id: REPORT_TOAST_ID, duration: Infinity },
  )
}
