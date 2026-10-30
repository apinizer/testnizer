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
 *   - an absolute path is NOT restricted: absolute paths that existing
 *     requests hold keep working;
 *   - a relative path must stay INSIDE the working directory (issue #290,
 *     security): `../../etc/passwd`, or a symlink in the folder that points
 *     out of it, is refused with a message naming the setting. A shared
 *     project or an imported collection holds relative paths; without this,
 *     it could make Send / Run upload any file the app can read.
 *
 * The setting is MACHINE-LOCAL (electron-store, not `shared_settings`): a
 * folder on one computer means nothing on another.
 */
import { promises as fs } from 'fs'
import { isAbsolute, relative, resolve, sep } from 'path'
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
  const resolved = new Map<string, string>()
  for (const p of [...formFiles.map((i) => i.filePath as string), ...(binary ? [binary] : [])]) {
    if (!resolved.has(p)) resolved.set(p, await resolveInside(dir, p))
  }
  const resolveIn = (p: string): string => resolved.get(p) as string
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

/** Does `rel` (from `path.relative(base, x)`) leave `base`? */
function escapes(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

async function realpathOr(p: string): Promise<string> {
  try {
    return await fs.realpath(p)
  } catch {
    return p
  }
}

/**
 * `p` (relative) resolved in `dir`, or a user-facing error when it lands
 * outside `dir` — lexically (`../`) or through a symlink (real path compared
 * to real path, so a working directory that is itself under a symlink, like
 * macOS `/var` → `/private/var`, still matches). A file that does not exist
 * is checked lexically only; reading it fails later with the engine's own
 * message.
 */
async function resolveInside(dir: string, p: string): Promise<string> {
  const target = resolve(dir, p)
  let outside = escapes(relative(resolve(dir), target))
  if (!outside) {
    let real: string | undefined
    try {
      real = await fs.realpath(target)
    } catch {
      real = undefined
    }
    if (real !== undefined) outside = escapes(relative(await realpathOr(dir), real))
  }
  if (outside) {
    throw new Error(
      `The file path "${p}" resolves outside Project Settings → Working directory ("${dir}"). Use a path inside that folder, or an absolute path.`,
    )
  }
  return target
}
