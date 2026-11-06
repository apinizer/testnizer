/**
 * The renderer's side of the script trust gate (main owns the state and the
 * prompt: `ipc/project-trust.handler.ts`). Send and interactive Run ask here
 * before a script of the active project can run. No project (Quick Test) means
 * the user typed it. Anything but a clear "allowed" from main counts as refused.
 *
 * Every store imports this module, so it imports nothing that needs a DOM at load
 * time; toast and i18n load only when there is something to say (same rule as
 * `withheld-before-send.ts`).
 */
import { scriptHasCode } from '../../shared/script/has-code'

export async function ensureScriptsAllowed(
  projectId: string | null | undefined,
  options?: { hasScript?: boolean },
): Promise<boolean> {
  if (!projectId) return true
  try {
    const res = await window.api?.projectTrust?.ensure(projectId, options)
    return res?.success === true && res.data?.allowed === true
  } catch {
    return false
  }
}

const ENGLISH_REFUSAL =
  'Scripts from this project are not allowed on this computer, so the request was not sent. Send again and choose Allow, or allow them in Project Settings.'

/**
 * For a send about to run these scripts (the cascade, the request's own included;
 * the owner tab is the caller's, captured before its first await). `null` = go on;
 * otherwise the request must not be sent and this is what its tab shows.
 */
export async function sendScriptsRefusal(
  projectId: string | null | undefined,
  scripts: ReadonlyArray<string | null | undefined>,
): Promise<string | null> {
  if (!scripts.some(scriptHasCode)) return null
  if (await ensureScriptsAllowed(projectId, { hasScript: true })) return null
  try {
    const { t } = await import('./i18n')
    return t('scriptTrust.sendRefused')
  } catch {
    return ENGLISH_REFUSAL // No UI layer (tests without a DOM).
  }
}

/** "Not now" on a run: it did not start, and the toast says so. */
export async function notifyRunRefused(): Promise<void> {
  try {
    const [{ toast }, { t }] = await Promise.all([import('./toast'), import('./i18n')])
    toast.warning(t('scriptTrust.runRefused'))
  } catch {
    // No UI to tell in (tests without a DOM).
  }
}

/** Before an interactive run. A run hook may be typed but not saved, hence `hasScript`. */
export async function runScriptsAllowed(payload: {
  projectId: string
  runPreScript?: string
  runPostScript?: string
  runFailScript?: string
}): Promise<boolean> {
  const hooks = [payload.runPreScript, payload.runPostScript, payload.runFailScript]
  const hasScript = hooks.some(scriptHasCode)
  if (await ensureScriptsAllowed(payload.projectId, hasScript ? { hasScript } : undefined)) {
    return true
  }
  await notifyRunRefused()
  return false
}
