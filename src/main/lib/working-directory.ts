/**
 * The project's "Working directory" (Project Settings → General) — where a
 * RELATIVE form-data file part or binary body path is read from (issue #276),
 * and the only place a request may read a file from unless the user says
 * otherwise.
 *
 * Postman stores those paths relative to its own working directory, so an
 * imported collection carries `data/upload.json`, not an absolute path. The
 * setting used to be saved and never read.
 *
 * One owner for both execution paths: `executeHttpRequest` calls
 * `resolveBodyFilePaths` before anything else, so Send (request:send), Run,
 * Test Suites, the Scheduler and the legacy-TLS curl sidecar all resolve the
 * same way. Rules:
 *   - a relative path resolves against the working directory;
 *   - a relative path with no working directory set fails with a message
 *     that names the setting (it used to fail with "cannot read" against the
 *     app's own current directory);
 *   - a relative path must stay INSIDE the working directory (issue #290,
 *     security): `../../etc/passwd`, or a symlink in the folder that points
 *     out of it, is refused with a message naming the setting. A shared
 *     project or an imported collection holds relative paths; without this,
 *     it could make Send / Run upload any file the app can read;
 *   - an ABSOLUTE path is read only if it is inside the working directory, or
 *     if the project's `readFilesOutsideWorkingDirectory` is on. An imported
 *     collection or a pulled project can name `/Users/x/.ssh/id_rsa` too. A
 *     real pick in the request-body file picker turns the setting on
 *     (`dialog:openFile`), and so did the upgrade for projects that already
 *     held such a path (`db/files-outside-wd-migration.ts`);
 *   - a request with no project has no setting, so it reads no absolute path.
 *     That covers Quick Test, and a project request that lost its id: a tab
 *     restored from localStorage into Quick Test keeps its project body.
 *
 * Both settings are MACHINE-LOCAL (electron-store, never `shared_settings`,
 * and `mergeProjectSettings` ignores them there): a folder on one computer
 * means nothing on another, and a project file must not grant itself access.
 */
import { promises as fs } from 'fs'
import { isAbsolute, relative, resolve, sep } from 'path'
import { NO_PROJECT_SETTINGS_SCOPE } from '../../shared/request-settings'
import { bodyFilePaths, readableFormParts, type FileBodyLike } from './body-file-paths'
import {
  allowFilesOutsideWorkingDirectory,
  loadProjectSettings,
  type StoredProjectSettings,
} from './project-settings'

/** The working directory in these settings, trimmed; undefined when none is set. */
function workingDirectoryOf(settings: StoredProjectSettings | undefined): string | undefined {
  const dir = typeof settings?.workingDirectory === 'string' ? settings.workingDirectory.trim() : ''
  return dir || undefined
}

/**
 * `body` with every relative file path the request will read resolved
 * against the project's working directory. Returns `body` itself when there
 * is nothing to resolve (no settings read). Throws a user-facing message when
 * a file may not be read, or a relative path has no working directory.
 */
export async function resolveBodyFilePaths<B extends FileBodyLike>(
  body: B | undefined,
  projectId: string | null | undefined,
): Promise<B | undefined> {
  if (!body) return body
  // Only what the engine will actually read.
  const paths = bodyFilePaths(body)
  if (paths.length === 0) return body

  const settings = await loadProjectSettings(projectId || NO_PROJECT_SETTINGS_SCOPE)
  const dir = workingDirectoryOf(settings)

  if (settings?.readFilesOutsideWorkingDirectory !== true) {
    for (const p of paths.filter((x) => isAbsolute(x))) {
      if (!(await isInsideWorkingDirectory(dir, p)))
        throw new Error(outsideMessage(p, dir, projectId))
    }
  }

  const formFiles = readableFormParts(body).filter((i) => !isAbsolute(i.filePath as string))
  const binary =
    body.type === 'binary' && body.binaryPath && !isAbsolute(body.binaryPath)
      ? body.binaryPath
      : undefined
  if (formFiles.length === 0 && !binary) return body

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
      `The file path "${p}" resolves outside Project Settings → Working directory ("${dir}"). Use a path inside that folder, or pick the file again.`,
    )
  }
  return target
}

/**
 * Is `p` (absolute) inside the working directory? Real path against real path
 * (macOS `/var` → `/private/var`, a symlink in the folder that points out of
 * it). A file that does not exist has no real path: compared lexically against
 * the folder as written and as resolved, and reading it fails later anyway.
 * No folder, or a relative one, contains nothing.
 */
async function isInsideWorkingDirectory(dir: string | undefined, p: string): Promise<boolean> {
  if (!dir || !isAbsolute(dir)) return false
  const realDir = await realpathOr(dir)
  let real: string | undefined
  try {
    real = await fs.realpath(p)
  } catch {
    real = undefined
  }
  if (real !== undefined) return !escapes(relative(realDir, real))
  return !escapes(relative(resolve(dir), resolve(p))) || !escapes(relative(realDir, resolve(p)))
}

function outsideMessage(
  p: string,
  dir: string | undefined,
  projectId: string | null | undefined,
): string {
  if (!projectId) {
    return `This request is not part of a project, and the file "${p}" was not picked in this app. Pick the file in the request's Body tab to read it.`
  }
  const where = dir
    ? `outside Project Settings → Working directory ("${dir}")`
    : 'outside the working directory, and Project Settings → Working directory is not set'
  return `The file "${p}" is ${where}. To read it, turn on Project Settings → Read files outside the working directory, or pick the file again.`
}

/**
 * A file the user picked for a request body is consent: a pick outside the
 * working directory turns the project's setting on. `dialog:openFile` calls
 * this only after a pick that was not cancelled.
 */
export async function allowPickedBodyFiles(projectId: string, picked: string[]): Promise<void> {
  const dir = workingDirectoryOf(await loadProjectSettings(projectId))
  for (const p of picked) {
    if (!(await isInsideWorkingDirectory(dir, p))) {
      await allowFilesOutsideWorkingDirectory(projectId)
      return
    }
  }
}
