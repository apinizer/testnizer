/**
 * "Run now" on a task already running: no second run, and the fact is reported.
 *
 * `scheduler:runNow` fired `executeScheduledRun` with no in-flight guard, so a
 * double-click meant two concurrent runs of the same task. The view has no way to
 * know a task is running either, and it must still know after the user leaves the
 * tab and comes back, so `scheduler:list` answers that from main.
 *
 * The run is held open by a stub so "while it runs" is really while it runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const sent: Array<{ channel: string; payload: unknown }> = []
const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const runner = vi.hoisted(() => ({
  calls: 0,
  finish: [] as Array<(outcome?: Error) => void>,
}))
vi.mock('../../../src/main/ipc/runner.handler', () => ({
  registerRunnerHandlers: () => {},
  executeCollectionForScheduler: () => {
    runner.calls++
    return new Promise((resolve, reject) => {
      runner.finish.push((outcome) =>
        outcome ? reject(outcome) : resolve({ results: [], summary: {} }),
      )
    })
  },
}))

const { registerSchedulerHandlers, stopAllSchedulers } =
  await import('../../../src/main/ipc/scheduler.handler')

let projectId = ''
let taskId = ''

async function createTask(endpointIds = ['ep-1']): Promise<string> {
  const res = (await harness.invoke('scheduler:create', {
    projectId,
    name: 'Nightly',
    endpointIds,
    intervalValue: 60,
    intervalUnit: 'minutes',
  })) as { data: { id: string } }
  return res.data.id
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))
const runNow = (id = taskId): Promise<{ success: boolean; data?: { started: boolean } }> =>
  harness.invoke('scheduler:runNow', id) as Promise<{
    success: boolean
    data?: { started: boolean }
  }>
async function isRunning(id = taskId): Promise<boolean | undefined> {
  const list = (await harness.invoke('scheduler:list', projectId)) as {
    data: Array<{ id: string; running?: boolean }>
  }
  return list.data.find((t) => t.id === id)?.running
}
const completions = (): unknown[] => sent.filter((s) => s.channel === 'scheduler:runCompleted')

beforeEach(async () => {
  harness.reset()
  sent.length = 0
  runner.calls = 0
  runner.finish = []
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerSchedulerHandlers()
  taskId = await createTask()
})
afterEach(async () => {
  runner.finish.forEach((finish) => finish())
  await settle()
  stopAllSchedulers()
})

describe('scheduler:runNow', () => {
  it('a double-click runs once and tells the second click so', async () => {
    const [first, second] = [await runNow(), await runNow()]
    await settle()
    expect(runner.calls).toBe(1)
    expect(first).toEqual({ success: true, data: { started: true } })
    expect(second).toEqual({ success: true, data: { started: false } })
  })

  it('the list says a task is running, for a view that comes back mid-run', async () => {
    expect(await isRunning()).toBe(false)
    await runNow()
    await settle()
    expect(await isRunning()).toBe(true)

    runner.finish[0]()
    await settle()
    expect(await isRunning()).toBe(false)
    expect(completions()).toHaveLength(1)
  })

  it('a task can run again once the run has ended', async () => {
    await runNow()
    await settle()
    runner.finish[0]()
    await settle()
    expect(await runNow()).toEqual({ success: true, data: { started: true } })
    await settle()
    expect(runner.calls).toBe(2)
  })

  it('a run that fails still ends: the spinner has an event to stop on', async () => {
    await runNow()
    await settle()
    runner.finish[0](new Error('boom'))
    await settle()
    expect(await isRunning()).toBe(false)
    expect(completions()).toHaveLength(1)
    expect(await runNow()).toEqual({ success: true, data: { started: true } })
  })

  it('a task with nothing to run ends at once, and says so', async () => {
    const empty = await createTask([])
    expect(await runNow(empty)).toEqual({ success: true, data: { started: true } })
    await settle()
    expect(await isRunning(empty)).toBe(false)
    expect(completions()).toHaveLength(1)
  })

  it('two tasks are independent', async () => {
    const other = await createTask(['ep-2'])
    await runNow()
    expect(await runNow(other)).toEqual({ success: true, data: { started: true } })
    await settle()
    expect(runner.calls).toBe(2)
  })
})
