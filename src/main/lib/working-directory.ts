/**
 * The project's "Working directory" (Project Settings → General) — where a
 * RELATIVE form-data file part or binary body path is read from (issue #276).
 *
 * Postman stores those paths relative to its own working directory, so an
 * imported collection carries `data/upload.json`, not an absolute path. The
 * setting used to be saved and never read.
 *
 * One owner for both execution paths: `executeHttpRequest` calls
 * `resolveBodyFilePaths` before anything else, so Send (request:send), Run,
 * Test Suites, the Scheduler and the legacy-TLS curl sidecar all resolve the
 * same way. Rules:
 *   - an ABSOLUTE path is used exactly as before;
 *   - a relative path resolves against the working directory;
 *   - a relative path with no working directory set fails with a message
 *     that names the setting (it used to fail with "cannot read" against the
 *     app's own current directory);
 *   - no "outside the working directory" restriction: absolute paths that
 *     existing requests hold keep working.
 *
 * The setting is MACHINE-LOCAL (electron-store, not `shared_settings`): a
 * folder on one computer means nothing on another.
 */
import { isAbsolute, resolve } from 'path'
import { loadProjectSettings } from './project-settings'

/** The body fields that name files on disk (http.engine `RequestBody`). */
export interface FileBodyLike {
  type: string
  formData?: Array<{ key?: string; enabled?: boolean; type?: string; filePath?: string }>
  binaryPath?: string
}

const isRelative = (p: string | undefined): p is string => !!p && !isAbsolute(p)

/** The project's working directory, trimmed; undefined when none is set. */
export async function projectWorkingDirectory(
  projectId: string | null | undefined,
): Promise<string | undefined> {
  if (!projectId) return undefined
  const settings = await loadProjectSettings(projectId)
  const dir = typeof settings?.workingDirectory === 'string' ? settings.workingDirectory.trim() : ''
  return dir || undefined
}

/**
 * `body` with every relative file path the request will read resolved
 * against the project's working directory. Returns `body` itself when there
 * is nothing to resolve (no settings read). Throws a user-facing message when
 * a relative path has no working directory to resolve against.
 */
export async function resolveBodyFilePaths<B extends FileBodyLike>(
  body: B | undefined,
  projectId: string | null | undefined,
): Promise<B | undefined> {
  if (!body) return body
  // Only what the engine will actually read: enabled, named file parts of a
  // form-data body; the binary path of a binary body.
  const formFiles =
    body.type === 'form-data'
      ? (body.formData ?? []).filter(
          (i) => i.enabled !== false && !!i.key && i.type === 'file' && isRelative(i.filePath),
        )
      : []
  const binary = body.type === 'binary' && isRelative(body.binaryPath) ? body.binaryPath : undefined
  if (formFiles.length === 0 && !binary) return body

  const dir = await projectWorkingDirectory(projectId)
  if (!dir) {
    const first = binary ?? formFiles[0].filePath
    throw new Error(
      `The file path "${first}" is relative. Set Project Settings → Working directory to the folder it is relative to, or pick the file again.`,
    )
  }
  if (!isAbsolute(dir)) {
    throw new Error(
      `Project Settings → Working directory must be an absolute folder path (it is "${dir}").`,
    )
  }
  const resolveIn = (p: string): string => resolve(dir, p)
  return {
    ...body,
    ...(formFiles.length > 0
      ? {
          formData: body.formData?.map((i) =>
            formFiles.includes(i) ? { ...i, filePath: resolveIn(i.filePath as string) } : i,
          ),
        }
      : {}),
    ...(binary ? { binaryPath: resolveIn(binary) } : {}),
  }
}
