/**
 * Command Palette → "Open collection runner" reuses the single runner tab.
 * That tab may still carry the previous session's payload (a Scheduled-Tasks
 * view from the Tests sidebar, a suite scope from "Run Suite", an auto-run),
 * and the remounted RunnerTab replays it once per session token — so the
 * palette landed on Scheduled Tasks (no "Run Sequence" at all) or on a
 * suite-filtered list that hid the request the user had just saved. The
 * full ui suite tripped over this four times in a row; the fix mirrors what
 * openFolderRunner already did: an explicit config open clears the payload.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { openOrReuseRunnerTab } from '../../src/renderer/lib/open-runner-tab'
import { runnerKey } from '../../src/renderer/lib/runner-storage'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'

const TAB = 'runner-main'

beforeEach(() => {
  sessionStorage.clear()
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

describe('openOrReuseRunnerTab({ view: "config" })', () => {
  it('drops the reused tab’s stale payload so the palette lands on a project-wide config', () => {
    // A previous session parked the tab on Scheduled Tasks…
    openOrReuseRunnerTab({ viewScheduledTasks: true })
    const reportKey = runnerKey('report', TAB)!
    const spentKey = runnerKey('report-spent', TAB)!
    sessionStorage.setItem(spentKey, 'old-token')
    expect(sessionStorage.getItem(reportKey)).toContain('viewScheduledTasks')
    const before = useTabsStore.getState().tabs.find((t) => t.protocol === 'runner')!

    // …then the user explicitly asks for the collection runner.
    openOrReuseRunnerTab(undefined, 'Runner', { view: 'config' })

    expect(sessionStorage.getItem(runnerKey('view', TAB)!)).toBe('config-explicit')
    expect(sessionStorage.getItem(reportKey)).toBeNull()
    expect(sessionStorage.getItem(spentKey)).toBeNull()
    const after = useTabsStore.getState().tabs.find((t) => t.protocol === 'runner')!
    expect(after.id).toBe(before.id) // reused, not duplicated
    expect(after.sessionKey).not.toBe(before.sessionKey) // re-armed → remount
    expect(useTabsStore.getState().tabs.filter((t) => t.protocol === 'runner')).toHaveLength(1)
  })

  it('also forgets a suite scope, so the list is the whole project again', () => {
    openOrReuseRunnerTab({ sourceType: 'suite', suiteId: 's-1', endpointIds: ['e1'] })
    openOrReuseRunnerTab(undefined, 'Runner', { view: 'config' })
    expect(sessionStorage.getItem(runnerKey('report', TAB)!)).toBeNull()
  })

  it('keeps a payload that the SAME call provides (explicit config with data)', () => {
    openOrReuseRunnerTab({ viewScheduledTasks: true })
    openOrReuseRunnerTab({ sourceType: 'apis', autoRun: false }, 'Runner', { view: 'config' })
    expect(sessionStorage.getItem(runnerKey('report', TAB)!)).toContain('"sourceType":"apis"')
  })
})
