/**
 * 1.6.0 screen review — text items, grouped.
 *
 * G-06 (issue #258): Project Settings → Overview printed created / updated as
 *   "10/31/2026" in the Turkish UI (a bare `toLocaleDateString()` follows the
 *   OS, not the app language). Every renderer date goes through
 *   `lib/format-datetime.ts`; a source guard keeps bare `toLocale*String()`
 *   calls out.
 * G-09: the Runner results counter "All tests / Tüm testler" counted REQUESTS
 *   (rows said "No tests found"). It and the All Runs column read
 *   "All requests / Tüm istekler".
 * G-13: Project Settings → About printed the raw Node platform ("darwin").
 */
import * as React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import {
  AboutPane,
  OverviewPane,
} from '../../src/renderer/components/modals/project-settings-panes'
import { platformLabel } from '../../src/renderer/lib/platform-label'
import { valuesInAllLocales } from '../../src/renderer/lib/i18n'
import { installEnUsDefault, uninstallEnUsDefault, useLocale } from './helpers/default-locale-shim'

const OCT_31 = new Date(2026, 9, 31, 10, 0, 0).getTime()

function overview(): React.ReactElement {
  const noop = (): void => {}
  return (
    <OverviewPane
      name="Acme"
      desc=""
      iconMode="auto"
      iconEmoji=""
      iconColor="#2d5fa0"
      onNameChange={noop}
      onDescChange={noop}
      onIconModeChange={noop}
      onIconEmojiChange={noop}
      onIconColorChange={noop}
      typeLabel="HTTP"
      createdAt={OCT_31}
      updatedAt={OCT_31}
    />
  )
}

beforeEach(() => {
  mockWindowApi()
  installEnUsDefault()
})
afterEach(() => {
  cleanup()
  uninstallEnUsDefault()
  useLocale('en')
})

describe('G-06 — dates follow the app language', () => {
  it('Overview created / updated in Turkish: "31 Eki 2026", never "10/31/2026"', () => {
    useLocale('tr')
    render(overview())
    expect(screen.getAllByText('31 Eki 2026')).toHaveLength(2)
    expect(document.body.textContent).not.toContain('10/31/2026')
  })

  it('Overview in English', () => {
    render(overview())
    expect(screen.getAllByText('Oct 31, 2026')).toHaveLength(2)
  })

  it('no renderer source calls a bare toLocale*String() (it follows the OS locale)', () => {
    const root = join(__dirname, '../../src/renderer')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(name)) files.push(p)
      }
    }
    walk(root)
    const bare = /\.toLocale(Date|Time)?String\(\s*\)/
    const offenders = files
      .filter((f) => !f.endsWith('lib/format-datetime.ts'))
      .filter((f) => bare.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f))
    expect(offenders).toEqual([])
  })
})

describe('G-09 — the Runner counter counts requests', () => {
  it('"All requests" / "Tüm istekler"', () => {
    expect(valuesInAllLocales('runnerHistory.colAllRequests')).toEqual([
      'All requests',
      'Tüm istekler',
    ])
    expect(valuesInAllLocales('runnerHistory.colAllTests')).toEqual([])
  })
})

describe('G-13 — About shows a product name for the platform', () => {
  it('maps Node platform ids', () => {
    expect(platformLabel('darwin')).toBe('macOS')
    expect(platformLabel('win32')).toBe('Windows')
    expect(platformLabel('linux')).toBe('Linux')
    expect(platformLabel('freebsd')).toBe('freebsd')
    expect(platformLabel(undefined)).toBeUndefined()
  })

  it('the About pane renders "macOS", not "darwin"', () => {
    ;(window as unknown as { electron: unknown }).electron = {
      process: { platform: 'darwin', versions: { electron: '44.9.3', node: '24', chrome: '152' } },
    }
    render(<AboutPane />)
    expect(screen.getByText('macOS')).toBeInTheDocument()
    expect(screen.queryByText('darwin')).toBeNull()
  })
})
