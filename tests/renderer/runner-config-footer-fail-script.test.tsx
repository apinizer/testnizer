/**
 * Issue #255 (Start run below the fold) + issue #267 (Run fail script editor).
 *
 * ── CONTRACT (the implementer must satisfy this file) ──────────────────────
 *
 * #255 — `RunnerConfig`:
 *   - The Start run / Schedule button (`data-testid="runner-start"`) and the
 *     Save configuration button (`runner-save-config`) live in an action bar
 *     (`data-testid="runner-action-bar"`) that is
 *       * NOT inside the scrolling element (the one carrying `overflow-auto`),
 *       * a SIBLING that follows the scroll container inside the same flex
 *         column (so it is pinned to the bottom of the column),
 *       * non-shrinking (`shrink-0` class) with a top border so it reads as a bar.
 *   - Everything else (the forms, lifecycle editors) stays inside the scroller.
 *   jsdom has no layout, so this pins the DOM STRUCTURE; the 1400x900 geometry
 *   check is the e2e spec (tests/e2e/ui/tur1/18-runner-report.spec.ts).
 *
 * #267 — `RunnerConfig` props: `runFailScript: string`, `setRunFailScript:
 *   (v: string) => void` (declared optional with a '' fallback so older call
 *   sites/tests keep rendering). Under "Run lifecycle", after the teardown
 *   script, a textarea `data-testid="runner-fail-script"` labelled
 *   i18n `runLifecycle.failScript` with hint i18n `runLifecycle.failScriptHint`
 *   (EN text pinned below, TR translated — both locales, two distinct values).
 *   `RunnerTab` keeps the state, restores it from the suite run config, saves it
 *   with `buildSuiteRunConfig`, and sends `runFailScript` in the `runner:execute`
 *   payload (trimmed; omitted when blank) — the wire test at the bottom.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'

vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then'
          ? undefined
          : typeof p === 'string' && p.startsWith('on')
            ? () => () => {}
            : () => Promise.resolve({ success: true, data: null }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import RunnerConfig from '../../src/renderer/components/runner/RunnerConfig'
import Workbench from '../../src/renderer/components/layout/Workbench'
import { openFolderRunner } from '../../src/renderer/lib/open-runner-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale, t, valuesInAllLocales } from '../../src/renderer/lib/i18n'
import type { TreeNode, Tab } from '../../src/renderer/types'
import type { RunnerExecuteOptions } from '../../src/shared/runner-types'
;(globalThis as unknown as { React: typeof React }).React = React

const noop = (): void => {}

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

function renderConfig(over: Record<string, unknown> = {}): void {
  render(
    <RunnerConfig
      delay={0}
      setDelay={noop}
      iterationDelay={0}
      setIterationDelay={noop}
      iterations={1}
      setIterations={noop}
      environmentId=""
      setEnvironmentId={noop}
      stopOnError
      setStopOnError={noop}
      persistResponses
      setPersistResponses={noop}
      keepVariableValues
      setKeepVariableValues={noop}
      iterationData={[]}
      setIterationData={noop}
      runPreScript=""
      setRunPreScript={noop}
      runPostScript=""
      setRunPostScript={noop}
      runFailScript=""
      setRunFailScript={noop}
      onRun={noop}
      onSchedule={noop}
      isRunning={false}
      selectedCount={2}
      canSchedule
      onSaveConfig={async () => true}
      {...over}
    />,
  )
}

beforeEach(() => {
  useLocale('en')
})
afterEach(() => {
  cleanup()
  useLocale('en')
})

/** The scrolling sibling of the action bar (the direct child carrying `overflow-auto`). */
function scrollerOf(bar: HTMLElement): HTMLElement | null {
  const siblings = Array.from(bar.parentElement?.children ?? []) as HTMLElement[]
  return siblings.find((el) => el.classList.contains('overflow-auto')) ?? null
}

describe('issue #255 — the primary action is never below the fold', () => {
  it('Start run sits outside the scrolling element, in a pinned action bar', () => {
    renderConfig()
    const start = screen.getByTestId('runner-start')
    const bar = screen.getByTestId('runner-action-bar')
    expect(bar).toContainElement(start)

    // No ancestor of the button scrolls: it can never be scrolled out of view.
    expect(start.closest('.overflow-auto')).toBeNull()
    expect(bar.closest('.overflow-auto')).toBeNull()

    // The bar is a non-shrinking sibling AFTER the scroller in the column.
    expect(bar.className).toMatch(/\bshrink-0\b/)
    const scroller = scrollerOf(bar)
    expect(scroller, 'the config column keeps a scrolling body').not.toBeNull()
    expect(scroller!.parentElement).toBe(bar.parentElement)
    expect(
      scroller!.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the bar comes after the scroller',
    ).toBeTruthy()
  })

  it('Save configuration is in the same pinned bar; the forms stay in the scroller', () => {
    renderConfig()
    const bar = screen.getByTestId('runner-action-bar')
    expect(bar).toContainElement(screen.getByTestId('runner-save-config'))
    const scroller = scrollerOf(bar)!
    expect(scroller).toContainElement(screen.getByTestId('runner-pre-script'))
    expect(scroller).toContainElement(screen.getByTestId('runner-fail-script'))
    expect(scroller).toContainElement(screen.getByLabelText(/Stop run if an error occurs/i))
  })

  it('the bar follows the mode: manual says Start run, schedule says Schedule', () => {
    renderConfig()
    expect(screen.getByTestId('runner-start').textContent).toMatch(/Start run/)
    act(() => {
      fireEvent.click(screen.getByLabelText(/Schedule runs/i))
    })
    expect(screen.getByTestId('runner-start').textContent).toMatch(/Schedule/)
    expect(screen.getByTestId('runner-start').closest('[data-testid="runner-action-bar"]')).not.toBeNull()
  })

  it('without a Save handler (APIs runs) the bar still holds Start and nothing scrolls it away', () => {
    renderConfig({ onSaveConfig: undefined, canSchedule: false })
    expect(screen.queryByTestId('runner-save-config')).toBeNull()
    expect(screen.getByTestId('runner-action-bar')).toContainElement(screen.getByTestId('runner-start'))
  })

  it('a disabled Start (no selection) is still reachable in the bar', () => {
    renderConfig({ selectedCount: 0 })
    expect(screen.getByTestId('runner-start')).toBeDisabled()
    expect(screen.getByTestId('runner-action-bar')).toContainElement(screen.getByTestId('runner-start'))
  })
})

describe('issue #267 — Run fail script editor', () => {
  it('renders a third lifecycle editor after the teardown script, with the issue\'s hint', () => {
    renderConfig()
    const pre = screen.getByTestId('runner-pre-script')
    const post = screen.getByTestId('runner-post-script')
    const fail = screen.getByTestId('runner-fail-script')
    expect(fail.tagName).toBe('TEXTAREA')
    expect(post.compareDocumentPosition(fail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pre.compareDocumentPosition(fail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(screen.getByText('Run fail script')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Runs once after teardown when the run verdict is failed. Does not run on a green run. Does not change the verdict.',
      ),
    ).toBeInTheDocument()
  })

  it('typing calls setRunFailScript and shows the value', () => {
    const setRunFailScript = vi.fn()
    renderConfig({ runFailScript: 'pm.test("x", () => {})', setRunFailScript })
    const fail = screen.getByTestId('runner-fail-script') as HTMLTextAreaElement
    expect(fail.value).toBe('pm.test("x", () => {})')
    fireEvent.change(fail, { target: { value: 'await pm.sendRequest("https://hooks.test")' } })
    expect(setRunFailScript).toHaveBeenCalledWith('await pm.sendRequest("https://hooks.test")')
  })

  it('i18n keys: EN is the issue text, TR is a distinct translation (both locales present)', () => {
    expect(t('runLifecycle.failScript')).toBe('Run fail script')
    expect(t('runLifecycle.failScriptHint')).toBe(
      'Runs once after teardown when the run verdict is failed. Does not run on a green run. Does not change the verdict.',
    )
    for (const key of ['runLifecycle.failScript', 'runLifecycle.failScriptHint']) {
      const values = valuesInAllLocales(key)
      expect(values).toHaveLength(2)
      expect(values.every((v) => v.trim().length > 0), key).toBe(true)
      expect(new Set(values).size, `${key} must be translated, not copied`).toBe(2)
    }
  })

  it('Turkish renders the translated label and hint (no English leftovers from this editor)', () => {
    useLocale('tr')
    renderConfig()
    expect(screen.getByText(t('runLifecycle.failScript'))).toBeInTheDocument()
    expect(screen.getByText(t('runLifecycle.failScriptHint'))).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bRun fail script\b/)
    expect(document.body.textContent).not.toMatch(/\bverdict\b/)
  })
})

// ─── The wire: the editor's value reaches runner:execute ──────────────────

function tree(): TreeNode[] {
  return [
    {
      id: 'default-module',
      type: 'module',
      label: 'Default module',
      children: [
        {
          id: 'folder-a',
          type: 'folder',
          label: 'Folder A',
          children: [
            { id: 'ep-a1', type: 'endpoint', label: 'Alpha endpoint', method: 'GET', path: '/a' },
          ],
        },
      ],
    },
  ]
}

describe('issue #267 — RunnerTab sends runFailScript in the runner:execute payload', () => {
  let execute: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    execute = vi.fn().mockResolvedValue({ success: true, data: null })
    mockWindowApi({
      runner: {
        execute,
        stop: () => Promise.resolve({ success: true, data: true }),
        onProgress: () => () => {},
        history: () => Promise.resolve({ success: true, data: [] }),
      },
    })
    useWorkspaceStore.setState({
      activeWorkspaceId: 'ws-1',
      activeProjectId: 'proj-1',
      treeData: tree(),
      openNodeIds: new Set(['default-module']),
      searchQuery: '',
    })
    useUIStore.setState({ activeSidebarPage: 'tests' })
    const tab: Tab = {
      id: 'runner-folder-a',
      name: 'Folder A',
      protocol: 'runner',
      folderId: 'folder-a',
      isDirty: false,
      isLoading: false,
    }
    useTabsStore.setState({ tabs: [tab], activeTabId: 'runner-folder-a' })
  })

  async function startWith(script: string | null): Promise<RunnerExecuteOptions> {
    render(<Workbench />)
    act(() => {
      openFolderRunner('folder-a', 'Folder A')
    })
    if (script !== null) {
      const box = (await screen.findByTestId('runner-fail-script')) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: script } })
    }
    fireEvent.click(await screen.findByTestId('runner-start'))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    return execute.mock.calls[0][0] as RunnerExecuteOptions
  }

  it('sends the typed script, trimmed', async () => {
    const payload = await startWith('  await pm.sendRequest("https://hooks.test/alert")\n')
    expect(payload.runFailScript).toBe('await pm.sendRequest("https://hooks.test/alert")')
  })

  it('omits the field when the editor is blank', async () => {
    const payload = await startWith('   ')
    expect(payload.runFailScript).toBeUndefined()
    expect('runFailScript' in payload && payload.runFailScript !== undefined).toBe(false)
  })

  it('omits the field when the editor was never touched', async () => {
    const payload = await startWith(null)
    expect(payload.runFailScript).toBeUndefined()
  })
})
