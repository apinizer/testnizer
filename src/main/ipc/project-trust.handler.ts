/**
 * `projectTrust:*` — the prompt in front of a project's scripts. The state itself
 * is `lib/project-script-trust.ts`. The renderer can ask and can block; only the
 * click on the native dialog here clears a block, so no renderer value can.
 */
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { getDb } from '../db/database'
import {
  allowProjectScripts,
  blockProjectScripts,
  ensureLoaded,
  isProjectScriptsBlocked,
  promptLocale,
} from '../lib/project-script-trust'
import { collectProjectScripts } from '../lib/project-scripts'
import { exportProjectData } from './save.handler'

export interface ScriptTrustPrompt {
  title: string
  message: string
  detail: string
  allow: string
  notNow: string
}

/** The native dialog's text: names the project and how many scripts it holds. */
export function scriptTrustPrompt(locale: string, name: string, count: number): ScriptTrustPrompt {
  if (locale === 'tr') {
    const holds =
      count > 0
        ? `Bu proje ${count} script içeriyor.`
        : 'Bu projede henüz kayıtlı script yok; sonradan eklenenler de çalışır.'
    return {
      title: 'Testnizer — Script izni',
      message: `"${name}" projesindeki script'ler bu bilgisayarda çalışsın mı?`,
      detail:
        `${holds} Proje bu bilgisayarın dışından geldi. Script'ler korumalı alanda çalışmaz: ` +
        'kullanıcı hesabınızın erişebildiği her şeye erişebilir. Yalnızca kaynağa güveniyorsanız izin verin.',
      allow: "Bu bilgisayarda script'lere izin ver",
      notNow: 'Şimdi değil',
    }
  }
  const holds =
    count === 1
      ? 'This project holds 1 script.'
      : count > 1
        ? `This project holds ${count} scripts.`
        : 'This project holds no saved script yet; scripts added later will run too.'
  return {
    title: 'Testnizer — Allow scripts?',
    message: `Allow the scripts of "${name}" to run on this computer?`,
    detail:
      `${holds} The project came from outside this computer. Scripts are not sandboxed: they ` +
      'can reach anything your user account can. Allow them only if you trust the source.',
    allow: 'Allow scripts on this computer',
    notNow: 'Not now',
  }
}

/** Concurrent calls for one project share one dialog. */
const openPrompts = new Map<string, Promise<boolean>>()

function projectScriptCount(projectId: string): number {
  return collectProjectScripts(exportProjectData(projectId)).length
}

function projectLabel(projectId: string): string {
  const row = getDb()
    .prepare('SELECT name, display_name FROM projects WHERE id = ?')
    .get(projectId) as { name?: string; display_name?: string | null } | undefined
  return row?.display_name?.trim() || row?.name || projectId
}

async function askUser(
  event: IpcMainInvokeEvent,
  projectId: string,
  scriptCount: number,
): Promise<boolean> {
  const text = scriptTrustPrompt(await promptLocale(), projectLabel(projectId), scriptCount)
  const options = {
    type: 'warning' as const,
    title: text.title,
    message: text.message,
    detail: text.detail,
    buttons: [text.allow, text.notNow],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (response !== 0) return false
  await allowProjectScripts(projectId)
  return true
}

/**
 * Blocked + scripts → ask. `hasScript`: the caller is about to run a script that
 * may not be saved yet (typed in the editor, a run hook, the settings row's Allow
 * button). It can only make the prompt appear, it cannot allow anything.
 */
async function ensureAllowed(
  event: IpcMainInvokeEvent,
  projectId: string,
  hasScript: boolean,
): Promise<{ allowed: boolean; blocked: boolean; scriptCount: number }> {
  if (!(await isProjectScriptsBlocked(projectId))) {
    return { allowed: true, blocked: false, scriptCount: 0 }
  }
  const scriptCount = projectScriptCount(projectId)
  if (scriptCount === 0 && !hasScript) return { allowed: true, blocked: true, scriptCount }

  let prompt = openPrompts.get(projectId)
  if (!prompt) {
    prompt = askUser(event, projectId, scriptCount).finally(() => openPrompts.delete(projectId))
    openPrompts.set(projectId, prompt)
  }
  const allowed = await prompt
  return { allowed, blocked: !allowed, scriptCount }
}

export function registerProjectTrustHandlers(): void {
  void ensureLoaded()
  ipcMain.handle(
    'projectTrust:ensure',
    async (event, projectId: string, options?: { hasScript?: boolean }) => {
      try {
        const data = await ensureAllowed(event, projectId, options?.hasScript === true)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('projectTrust:status', async (_event, projectId: string) => {
    try {
      const blocked = await isProjectScriptsBlocked(projectId)
      return { success: true, data: { blocked, scriptCount: projectScriptCount(projectId) } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // The safe direction: the settings row's Block button.
  ipcMain.handle('projectTrust:block', async (_event, projectId: string) => {
    try {
      await blockProjectScripts(projectId)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
