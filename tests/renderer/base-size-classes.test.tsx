/**
 * Issue #245 (c) + (d): text that means "the app's base size" must follow the
 * Project Settings font size (13-16px).
 *
 * (c) Since issue #223 the named scale is tied to --font-size-base
 *     (`text-sm` = base), while an arbitrary `text-[13px]` stays 13px at the
 *     16px setting. ~51 spots used `text-[13px]` to mean "base"; they are now
 *     `text-sm`. The source scan below keeps new ones from creeping back: a
 *     fixed 13px is allowed only where it is deliberate, listed with a reason.
 * (d) Sibling mismatch: the MCP editor's sub-tab strips were a fixed 12px
 *     with `font-medium` on every tab, while the HTTP RequestEditor / response
 *     tabs inherit the base size, 600 when active and 400 when idle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import type { Tab } from '../../src/renderer/types'

vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const RENDERER = resolve(__dirname, '../../src/renderer')

/** Files where a fixed 13px is deliberate, with the reason. */
const FIXED_13_ALLOWED: Record<string, string> = {
  // the "⋯" row-actions glyph button (`leading-none`): a glyph size, not text
  'components/tools/keystore/AliasTable.tsx': 'glyph button',
  // every other text in this modal is inline `fontSize: 13`; converting one
  // paragraph would split it from its siblings at the 16px setting
  'components/shared/ScriptHelpModal.tsx': 'inline-13 cluster',
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

describe('text-[13px] is not used to mean "base size" (issue #245)', () => {
  it('only the allow-listed files keep a fixed 13px class', () => {
    const hits: string[] = []
    for (const f of sourceFiles(RENDERER)) {
      const rel = relative(RENDERER, f)
      if (FIXED_13_ALLOWED[rel]) continue
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/(^|[\s'"`:])text-\[13px\]/.test(line)) hits.push(`${rel}:${i + 1}`)
        })
    }
    expect(hits, 'use text-sm (= --font-size-base) instead').toEqual([])
  })
})

const { default: McpConfigTabs } =
  await import('../../src/renderer/components/protocols/mcp/McpConfigTabs')
const { default: McpResultTabs } =
  await import('../../src/renderer/components/protocols/mcp/McpResultTabs')
const { useMcpStore } = await import('../../src/renderer/stores/mcp.store')
const { useRequestStore } = await import('../../src/renderer/stores/request.store')
const { useTabsStore } = await import('../../src/renderer/stores/tabs.store')
const { setLocale } = await import('../../src/renderer/lib/i18n')

const TAB_ID = 'tab-mcp-size'

beforeEach(() => {
  window.localStorage.clear()
  setLocale('en')
  useTabsStore.setState({
    tabs: [{ id: TAB_ID, name: 'Echo', protocol: 'mcp', isDirty: false } as Tab],
    activeTabId: TAB_ID,
  })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab(TAB_ID)
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null } as never)
  useRequestStore.getState().switchToTab(TAB_ID)
})

afterEach(() => {
  cleanup()
})

/** Same rule as the HTTP RequestEditor / ResponsePane tabs. */
function expectHttpTabTypography(tabs: HTMLElement[]) {
  expect(tabs.length).toBeGreaterThan(1)
  for (const tab of tabs) {
    const cls = tab.className.split(/\s+/)
    expect(cls, tab.getAttribute('data-testid') ?? '').toContain('text-sm')
    expect(cls).not.toContain('text-[12px]')
    expect(cls).not.toContain('font-medium')
    const selected = tab.getAttribute('aria-selected') === 'true'
    expect(cls).toContain(selected ? 'font-semibold' : 'font-normal')
  }
}

describe('MCP sub-tabs match the HTTP editor tabs (issue #245)', () => {
  it('config strip (Authorization · Headers · Scripts · Tests · Settings)', () => {
    useMcpStore.getState().setConfigCollapsed(false)
    render(<McpConfigTabs />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.some((t) => t.getAttribute('aria-selected') === 'true')).toBe(true)
    expectHttpTabTypography(tabs)
  })

  it('result strip (Result · Test Results)', () => {
    render(
      <McpResultTabs tests={{ results: [{ name: 'ok', passed: true } as never] }}>
        <div />
      </McpResultTabs>,
    )
    expectHttpTabTypography(screen.getAllByRole('tab'))
  })

  it('the explorer section strip uses the same classes (source)', () => {
    const src = readFileSync(join(RENDERER, 'components/protocols/McpEditor.tsx'), 'utf8')
    const tab = src.slice(src.indexOf('data-testid={`mcp-section-${s.id}`}'))
    const strip = tab.slice(tab.indexOf('className={`'))
    const cls = strip.slice(0, strip.indexOf('}`}'))
    expect(cls).toContain('text-sm')
    expect(cls).not.toContain('text-[12px]')
    expect(cls).toContain("'border-[var(--accent)] font-semibold")
    expect(cls).toContain("'border-transparent font-normal")
  })
})
