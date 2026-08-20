/**
 * Multi-project isolation — the Runner tab leaked one project's run into
 * another's.
 *
 * `openOrReuseRunnerTab` puts every entry point on a single shared tab whose
 * id is the constant `runner-main`. Tab SETS are per project (the workspace
 * store swaps them on switch), but the id is not, so every sessionStorage key
 * derived from it — run results, report, suite scope, view — was shared
 * between projects. Nothing cleaned it up: `replaceAllTabs` only swaps the
 * array, `cleanupTabState` never touched sessionStorage, and the re-arm effect
 * sets the view without clearing results. Run a suite in project A, switch to
 * project B, open the Runner: A's results were sitting there.
 *
 * Keys are now built in one place and carry the project.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { runnerKey } from '../../src/renderer/lib/runner-storage'

const RUNNER_TAB = 'runner-main'

function inProject(id: string | null): void {
  useWorkspaceStore.setState({ activeProjectId: id })
}

beforeEach(() => {
  sessionStorage.clear()
  inProject(null)
})

describe('runner storage keys carry the project', () => {
  it('gives two projects different keys for the SAME tab id', () => {
    inProject('proj-a')
    const a = runnerKey('run-data', RUNNER_TAB)
    inProject('proj-b')
    const b = runnerKey('run-data', RUNNER_TAB)

    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('keeps every kind separated the same way', () => {
    const kinds = ['report', 'report-spent', 'view', 'run-data', 'results'] as const
    inProject('proj-a')
    const a = kinds.map((k) => runnerKey(k, RUNNER_TAB))
    inProject('proj-b')
    const b = kinds.map((k) => runnerKey(k, RUNNER_TAB))

    expect(new Set([...a, ...b]).size).toBe(kinds.length * 2)
  })

  it('is stable for the same project and tab', () => {
    inProject('proj-a')
    expect(runnerKey('results', RUNNER_TAB)).toBe(runnerKey('results', RUNNER_TAB))
  })

  it('scopes the Home screen, where no project is active, without colliding', () => {
    inProject(null)
    const home = runnerKey('run-data', RUNNER_TAB)
    inProject('proj-a')
    expect(home).not.toBe(runnerKey('run-data', RUNNER_TAB))
  })

  it('returns null with no tab, so callers keep their no-storage branch', () => {
    inProject('proj-a')
    expect(runnerKey('run-data', undefined)).toBeNull()
    expect(runnerKey('run-data', '')).toBeNull()
  })

  it('still separates two runner tabs within one project (folder runners)', () => {
    inProject('proj-a')
    expect(runnerKey('run-data', 'runner-folder-1')).not.toBe(
      runnerKey('run-data', 'runner-folder-2'),
    )
  })
})

describe('the reported leak', () => {
  it("does not serve project A's stored run to project B", () => {
    inProject('proj-a')
    const write = runnerKey('run-data', RUNNER_TAB)
    expect(write).toBeTruthy()
    sessionStorage.setItem(write as string, JSON.stringify({ results: ['A-run'], report: null }))

    // Switching projects swaps the tab set; the runner tab keeps its id.
    inProject('proj-b')
    const read = runnerKey('run-data', RUNNER_TAB)
    expect(sessionStorage.getItem(read as string)).toBeNull()

    // ...and A's run is still there when the user goes back.
    inProject('proj-a')
    expect(sessionStorage.getItem(runnerKey('run-data', RUNNER_TAB) as string)).toContain('A-run')
  })
})
