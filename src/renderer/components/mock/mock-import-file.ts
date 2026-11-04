/**
 * Reading a spec for a mock server: what is this file, and is there anything in
 * it to mock? Answered before a server exists, so a wrong file costs nothing.
 * The real import stays in main (`src/main/mock/importers.ts`); this only looks.
 */
import yaml from 'js-yaml'
import { classifyPostmanDocument } from '../../../shared/postman-detect'
import { t } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import { toast } from '../../lib/toast'

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
export const MOCK_IMPORT_MAX_BYTES = 50 * 1024 * 1024
const TITLE_MAX = 80
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)

function titleOf(root: Rec, key: 'title' | 'name', fileName: string): string {
  const named = isRec(root.info) ? root.info[key] : undefined
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

function parse(text: string): { root: unknown; json: boolean } | null {
  try {
    return { root: JSON.parse(text), json: true }
  } catch {
    try {
      return { root: yaml.load(text), json: false }
    } catch {
      return null
    }
  }
}

export function inspectMockImportText(text: string, fileName: string): MockImportInspection {
  const parsed = parse(text)
  if (!parsed || !isRec(parsed.root)) return { ok: false, error: t('mockNew.importNotRecognised') }
  const { root, json } = parsed

  const postman = classifyPostmanDocument(root)
  if (postman) {
    // The mock importer reads v2.x JSON; the other Postman files need their own path.
    if (postman.kind !== 'v2-collection' || !json) {
      return { ok: false, error: t('mockNew.importUnsupportedPostman') }
    }
    const endpointCount = countPostmanRequests(root.item)
    if (endpointCount === 0) return { ok: false, error: t('mockNew.importEmpty') }
    const title = titleOf(root, 'name', fileName)
    return { ok: true, file: { format: 'postman', text, fileName, title, endpointCount } }
  }

  if (root.openapi === undefined && root.swagger === undefined && root.paths === undefined) {
    return { ok: false, error: t('mockNew.importNotRecognised') }
  }
  const endpointCount = countOpenApiOperations(root.paths)
  if (endpointCount === 0) return { ok: false, error: t('mockNew.importEmpty') }
  const title = titleOf(root, 'title', fileName)
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
  const n = result.warnings.length
  const warn =
    n > 0 ? ` (${formatCount(n, t('mock.warningCountOne'), t('mock.warningCount'))})` : ''
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
  toast.success(
    t('mock.importDone')
      .replace('{endpoints}', endpoints)
      .replace('{responses}', responses)
      .replace('{warnings}', warn),
  )
}
