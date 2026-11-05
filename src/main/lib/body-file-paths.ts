/**
 * The files a request body makes the engine read — one definition for the gate
 * (`working-directory.ts`), the startup migration and the import warnings.
 * Importers load it without the settings store or the database (the scan takes one).
 */
import { isAbsolute } from 'path'
import type Database from 'better-sqlite3'

/** The body fields that name files on disk (http.engine `RequestBody`). */
export interface FileBodyLike {
  type: string
  formData?: Array<{ key?: string; enabled?: boolean; type?: string; filePath?: string }>
  binaryPath?: string
}

/** Enabled, named file parts of a form-data body: what the engine opens. */
export function readableFormParts<B extends FileBodyLike>(body: B): NonNullable<B['formData']> {
  if (body.type !== 'form-data' || !Array.isArray(body.formData)) return []
  return body.formData.filter(
    (i) => !!i && i.enabled !== false && !!i.key && i.type === 'file' && !!i.filePath,
  ) as NonNullable<B['formData']>
}

/** Every path `body` makes the engine read, form-data parts first. */
export function bodyFilePaths(body: FileBodyLike | undefined): string[] {
  if (!body) return []
  const paths = readableFormParts(body).map((i) => i.filePath as string)
  if (body.type === 'binary' && body.binaryPath) paths.push(body.binaryPath)
  return paths
}

/** The import report's line for each absolute path a request's body holds. */
export function absoluteFileWarnings(label: string, body: FileBodyLike | undefined): string[] {
  return bodyFilePaths(body)
    .filter((p) => isAbsolute(p))
    .map(
      (p) =>
        `"${label}": the file path "${p}" is absolute. It is read only if it is inside Project Settings → Working directory or Project Settings → Read files outside the working directory is on.`,
    )
}

/** Rows that can hold a request body, as JSON text columns, with their project. */
const MENTIONS = (col: string): string => `(${col} LIKE '%binaryPath%' OR ${col} LIKE '%filePath%')`
const ROW_QUERIES = [
  `SELECT project_id AS projectId, request_schema AS a, NULL AS b FROM endpoints
    WHERE ${MENTIONS('request_schema')}`,
  `SELECT project_id AS projectId, body AS a, metadata AS b FROM saved_requests
    WHERE project_id IS NOT NULL AND (${MENTIONS('body')} OR ${MENTIONS('metadata')})`,
  `SELECT s.project_id AS projectId, i.request_schema AS a, NULL AS b
     FROM test_suite_items i JOIN test_suites s ON s.id = i.suite_id
    WHERE ${MENTIONS('i.request_schema')}`,
]

/** A stored path that is absolute, or `{{dir}}/x`, which may resolve to one. */
function mayBeAbsolute(p: unknown): boolean {
  return typeof p === 'string' && (isAbsolute(p) || p.includes('{{'))
}

/** Does this JSON value hold a body that reads such a file, at any depth? */
function holdsAbsoluteFile(value: unknown): boolean {
  if (typeof value === 'string') {
    return /^\s*[{[]/.test(value) && /binaryPath|filePath/.test(value)
      ? holdsAbsoluteFile(JSON.parse(value))
      : false
  }
  if (Array.isArray(value)) return value.some(holdsAbsoluteFile)
  if (!value || typeof value !== 'object') return false
  if (bodyFilePaths(value as FileBodyLike).some(mayBeAbsolute)) return true
  return Object.values(value).some(holdsAbsoluteFile)
}

function columnHoldsAbsoluteFile(text: unknown): boolean {
  try {
    return holdsAbsoluteFile(text)
  } catch {
    return false // damaged JSON: not a request that can be sent
  }
}

/** Every project holding a request that reads a file by an absolute path. */
export function projectsWithAbsoluteFiles(db: Database.Database): Set<string> {
  const projects = new Set<string>()
  for (const sql of ROW_QUERIES) {
    const rows = db.prepare(sql).all() as Array<{ projectId: string; a: unknown; b: unknown }>
    for (const { projectId, a, b } of rows) {
      if (columnHoldsAbsoluteFile(a) || columnHoldsAbsoluteFile(b)) projects.add(projectId)
    }
  }
  return projects
}
