/**
 * The files a request body makes the engine read — one definition for the gate
 * (`working-directory.ts`), the startup migration and the import warnings.
 * Pure: importers load it without the settings store or the database.
 */
import { isAbsolute } from 'path'

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
