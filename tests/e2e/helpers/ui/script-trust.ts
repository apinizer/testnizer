/**
 * The script trust dialog is native, so nobody can click it from a test and an
 * unanswered one would hang the shared Electron. This replaces
 * `dialog.showMessageBox` in main for that dialog only (every other message box
 * goes to the real one) and records what was shown. The app has no test switch:
 * main calls the same function it always calls.
 *
 * `_setup.ts` installs it answering Allow, so a spec that imports a scripted
 * collection for another reason behaves as it did. A spec about the gate sets its
 * own answer; the per-test reset puts Allow back.
 */
import { expect, type ElectronApplication, type Page } from '@playwright/test'

export type ScriptTrustAnswer = 'allow' | 'notNow'

export interface ScriptTrustPrompt {
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

interface StubState {
  answer: ScriptTrustAnswer | 'hold'
  calls: ScriptTrustPrompt[]
  held: Array<(answer: ScriptTrustAnswer) => void>
}

/** The Allow button in each language; only this dialog has one. */
const ALLOW_LABELS = ['Allow scripts on this computer', "Bu bilgisayarda script'lere izin ver"]

export async function stubScriptTrustDialog(
  app: ElectronApplication,
  answer: ScriptTrustAnswer | 'hold',
): Promise<void> {
  await app.evaluate(
    ({ dialog }, { next, labels }) => {
      const d = dialog as unknown as {
        showMessageBox: (...args: unknown[]) => Promise<unknown>
        __scriptTrust?: StubState
      }
      if (!d.__scriptTrust) {
        const original = d.showMessageBox
        const stub: StubState = { answer: 'allow', calls: [], held: [] }
        d.__scriptTrust = stub
        d.showMessageBox = (...args: unknown[]) => {
          const options = args[args.length - 1] as ScriptTrustPrompt
          if (!options?.buttons?.some((b) => labels.includes(b))) {
            return original.apply(dialog, args)
          }
          stub.calls.push({
            message: options.message,
            detail: options.detail,
            buttons: options.buttons,
            defaultId: options.defaultId,
            cancelId: options.cancelId,
          })
          const reply = (a: ScriptTrustAnswer) => ({
            response: a === 'allow' ? 0 : 1,
            checkboxChecked: false,
          })
          if (stub.answer === 'hold') {
            return new Promise((resolve) => stub.held.push((a) => resolve(reply(a))))
          }
          return Promise.resolve(reply(stub.answer))
        }
      }
      d.__scriptTrust.answer = next
    },
    { next: answer, labels: ALLOW_LABELS },
  )
}

/** What the dialog has shown since the last reset. */
export async function scriptTrustPrompts(app: ElectronApplication): Promise<ScriptTrustPrompt[]> {
  return app.evaluate(({ dialog }) => {
    const d = dialog as unknown as { __scriptTrust?: StubState }
    return d.__scriptTrust?.calls ?? []
  })
}

/** Forget the shown prompts and answer Allow again; a dialog still held gets Not now. */
export async function resetScriptTrustDialog(app: ElectronApplication): Promise<void> {
  await stubScriptTrustDialog(app, 'allow')
  await app.evaluate(({ dialog }) => {
    const d = dialog as unknown as { __scriptTrust?: StubState }
    if (!d.__scriptTrust) return
    d.__scriptTrust.calls = []
    for (const finish of d.__scriptTrust.held.splice(0)) finish('notNow')
  })
}

/** Wait for a dialog held by the `hold` answer, then close it with this answer. */
export async function answerHeldScriptTrustDialog(
  app: ElectronApplication,
  answer: ScriptTrustAnswer,
): Promise<void> {
  await waitForHeldScriptTrustDialog(app)
  await app.evaluate(({ dialog }, a) => {
    const d = dialog as unknown as { __scriptTrust?: StubState }
    for (const finish of d.__scriptTrust?.held.splice(0) ?? []) finish(a)
  }, answer)
}

/** Wait until a dialog is open and held, without answering it. */
export async function waitForHeldScriptTrustDialog(app: ElectronApplication): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(({ dialog }) => {
        const d = dialog as unknown as { __scriptTrust?: StubState }
        return d.__scriptTrust?.held.length ?? 0
      }),
    )
    .toBeGreaterThan(0)
}

interface TrustBridge {
  api: {
    projectTrust: {
      ensure: (
        id: string,
        options?: { hasScript?: boolean },
      ) => Promise<{ success: boolean; data?: { allowed: boolean }; error?: string }>
      status: (
        id: string,
      ) => Promise<{ success: boolean; data?: { blocked: boolean; scriptCount: number } }>
      block: (id: string) => Promise<{ success: boolean }>
    }
  }
}

export async function scriptTrustStatus(
  page: Page,
  projectId: string,
): Promise<{ blocked: boolean; scriptCount: number }> {
  return page.evaluate(async (id) => {
    const res = await (window as unknown as TrustBridge).api.projectTrust.status(id)
    return res.data ?? { blocked: false, scriptCount: 0 }
  }, projectId)
}

export async function blockProjectScripts(page: Page, projectId: string): Promise<void> {
  await page.evaluate(async (id) => {
    await (window as unknown as TrustBridge).api.projectTrust.block(id)
  }, projectId)
}

/**
 * Clears every project's block through the real prompt, so the dialog must be
 * answering Allow. Every project, not just the canonical one: a spec may have
 * imported a project file into a new one.
 */
export async function allowEveryProjectScripts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (
      window as unknown as TrustBridge & {
        api: {
          workspace: { list: () => Promise<{ data?: Array<{ id: string }> }> }
          project: { list: (id: string) => Promise<{ data?: Array<{ id: string }> }> }
        }
      }
    ).api
    for (const workspace of (await api.workspace.list()).data ?? []) {
      for (const project of (await api.project.list(workspace.id)).data ?? []) {
        await api.projectTrust.ensure(project.id, { hasScript: true })
      }
    }
  })
}
