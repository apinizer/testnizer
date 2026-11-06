/**
 * The Run now button shows a run in flight, per task, and keeps showing it after
 * the user leaves the view and comes back mid-run (Workbench unmounts it): the
 * answer lives in main, which also refuses a second run
 * (`tests/main/handlers/scheduler-run-now-guard.test.ts`).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowScriptTrustBridge } from '../helpers/script-trust-bridge'
import ScheduledTasksView from '../../src/renderer/components/runner/ScheduledTasksView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

const task = (id: string, name: string, running: boolean): Record<string, unknown> => ({
  id,
  name,
  running,
  project_id: 'p1',
  endpoint_ids: '["e1"]',
  folder_id: null,
  environment_id: null,
  interval_value: 1,
  interval_unit: 'hours',
  delay_ms: 0,
  enabled: 1,
  last_run_at: null,
  next_run_at: 1,
  created_at: 1,
  schedule_type: 'interval',
  schedule_time: null,
  schedule_days: null,
  schedule_cron: null,
  suite_id: null,
})

/** Main's view of what is running. */
let running: Set<string>
let completed: Array<(e: unknown) => void>
const runNow = vi.fn(async (id: string) => {
  const started = !running.has(id)
  running.add(id)
  return { success: true, data: { started } }
})

const rowOf = (name: string): HTMLElement =>
  screen
    .getAllByTestId('scheduled-task-row')
    .find((r) => r.getAttribute('data-task-name') === name) as HTMLElement

const spinnerIn = (name: string): Element | null =>
  rowOf(name).querySelector('[data-testid="scheduled-task-running"]')

const runNowIn = (name: string): HTMLButtonElement =>
  rowOf(name).querySelector('[data-testid="scheduled-task-run-now"]') as HTMLButtonElement

beforeEach(() => {
  running = new Set()
  completed = []
  runNow.mockClear()
  useWorkspaceStore.setState({ activeProjectId: 'p1' })
  ;(window as unknown as { api: unknown }).api = {
    projectTrust: allowScriptTrustBridge,
    scheduler: {
      list: async () => ({
        success: true,
        data: [task('t1', 'One', running.has('t1')), task('t2', 'Two', running.has('t2'))],
      }),
      runNow,
      history: async () => ({ success: true, data: [] }),
      taskEndpoints: async () => ({ success: true, data: { items: [], source: 'empty' } }),
      onRunCompleted: (cb: (e: unknown) => void) => {
        completed.push(cb)
        return () => {
          completed = completed.filter((c) => c !== cb)
        }
      },
    },
    testSuite: { list: async () => ({ success: true, data: [] }) },
  }
})
afterEach(cleanup)

describe('Run now', () => {
  it('spins on that task only, and cannot be clicked twice', async () => {
    render(<ScheduledTasksView onBack={() => {}} />)
    await screen.findAllByTestId('scheduled-task-row')

    fireEvent.click(runNowIn('One'))
    fireEvent.click(runNowIn('One'))

    await waitFor(() => expect(spinnerIn('One')).not.toBeNull())
    expect(runNow).toHaveBeenCalledTimes(1)
    expect(spinnerIn('Two')).toBeNull()
    expect(runNowIn('One').disabled).toBe(true)
    expect(runNowIn('Two').disabled).toBe(false)
  })

  it('leaving and coming back mid-run still shows it running', async () => {
    const first = render(<ScheduledTasksView onBack={() => {}} />)
    await screen.findAllByTestId('scheduled-task-row')
    fireEvent.click(runNowIn('One'))
    await waitFor(() => expect(spinnerIn('One')).not.toBeNull())

    first.unmount()
    render(<ScheduledTasksView onBack={() => {}} />)
    await screen.findAllByTestId('scheduled-task-row')
    await waitFor(() => expect(spinnerIn('One')).not.toBeNull())
  })

  it('stops spinning when the run ends, a failed run included', async () => {
    render(<ScheduledTasksView onBack={() => {}} />)
    await screen.findAllByTestId('scheduled-task-row')
    fireEvent.click(runNowIn('One'))
    await waitFor(() => expect(spinnerIn('One')).not.toBeNull())

    running.delete('t1')
    await act(async () => {
      completed.forEach((cb) => cb({ taskId: 't1', taskName: 'One' }))
    })
    await waitFor(() => expect(spinnerIn('One')).toBeNull())
    expect(runNowIn('One').disabled).toBe(false)
  })

  it('a run the schedule started, seen on opening the view, spins as well', async () => {
    running.add('t2')
    render(<ScheduledTasksView onBack={() => {}} />)
    await screen.findAllByTestId('scheduled-task-row')
    await waitFor(() => expect(spinnerIn('Two')).not.toBeNull())
  })
})
