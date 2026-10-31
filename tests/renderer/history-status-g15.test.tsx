/**
 * 1.6.0 screen review G-15 — a failed MQTT / SSE connection showed a GREEN
 * "-1" in the Recent endpoints list of the new-request page, and the History
 * sidebar printed the same raw "-1" (in red). Main writes -1 for a transport
 * failure (sse/ws/socketio/mqtt/mcp handlers); 0 is SUCCESS for MQTT,
 * Socket.IO, MCP and gRPC (gRPC OK), while gRPC codes 1–16 are failures.
 *
 * One helper (`lib/history-status.ts`) decides label + colour for every
 * surface: a failure reads "Error" / "Hata" in the danger colour with the
 * stored error message as tooltip; colours are theme tokens only.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import NewRequestWelcome from '../../src/renderer/components/layout/NewRequestWelcome'
import HistoryListPanel from '../../src/renderer/components/sidebar/HistoryListPanel'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { HistoryEntry } from '../../src/renderer/types'

type Display = { label: string; color: string; failed: boolean; title?: string }
type Fn = (
  e: Pick<HistoryEntry, 'status_code' | 'protocol' | 'response_snapshot'>,
  t: (k: string) => string,
) => Display | null

async function helper(): Promise<Fn> {
  const mod = (await import('../../src/renderer/lib/history-status').catch(() => ({}))) as {
    historyStatusDisplay?: Fn
  }
  expect(typeof mod.historyStatusDisplay, 'lib/history-status.ts historyStatusDisplay').toBe(
    'function',
  )
  return mod.historyStatusDisplay as Fn
}

const tEn = (k: string): string => (k === 'history.statusError' ? 'Error' : k)

const row = (
  id: string,
  protocol: HistoryEntry['protocol'],
  status: number | undefined,
  error?: string,
): HistoryEntry => ({
  id,
  protocol,
  method: protocol === 'http' ? 'GET' : 'CONNECT',
  url: `${protocol}://127.0.0.1:9/${id}`,
  status_code: status,
  request_snapshot: {},
  response_snapshot: error ? ({ error } as never) : undefined,
  executed_at: Date.now(),
})

const useLocale = (l: 'en' | 'tr'): void => {
  useUIStore.setState({ locale: l })
  setLocale(l)
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {}
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getState(),
    activeProjectId: 'p1',
    activeWorkspaceId: 'w1',
  })
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('historyStatusDisplay — the rule', () => {
  it('negative = transport failure on every protocol', async () => {
    const f = await helper()
    for (const p of ['mqtt', 'sse', 'websocket', 'socketio', 'mcp', 'http'] as const) {
      const d = f(row('x', p, -1, 'connect ECONNREFUSED 127.0.0.1:9'), tEn)
      expect(d, p).toMatchObject({ label: 'Error', color: 'var(--red)', failed: true })
      expect(d?.title).toBe('connect ECONNREFUSED 127.0.0.1:9')
    }
  })

  it('0 is success for MQTT / Socket.IO / MCP / gRPC, a failure for HTTP-like rows', async () => {
    const f = await helper()
    for (const p of ['mqtt', 'socketio', 'mcp', 'grpc'] as const) {
      expect(f(row('x', p, 0), tEn), p).toMatchObject({ color: 'var(--green)', failed: false })
    }
    for (const p of ['http', 'graphql', 'soap'] as const) {
      expect(f(row('x', p, 0), tEn), p).toMatchObject({ label: 'Error', failed: true })
    }
  })

  it('gRPC non-zero codes are failures; HTTP classes keep their tokens', async () => {
    const f = await helper()
    expect(f(row('x', 'grpc', 14), tEn)).toMatchObject({ label: '14', color: 'var(--red)' })
    expect(f(row('x', 'websocket', 101), tEn)).toMatchObject({ color: 'var(--green)' })
    expect(f(row('x', 'http', 204), tEn)).toMatchObject({ label: '204', color: 'var(--green)' })
    expect(f(row('x', 'http', 302), tEn)).toMatchObject({ color: 'var(--blue)' })
    expect(f(row('x', 'http', 404), tEn)).toMatchObject({ color: 'var(--orange)' })
    expect(f(row('x', 'http', 503), tEn)).toMatchObject({ color: 'var(--red)' })
    expect(f(row('x', 'http', undefined), tEn)).toBeNull()
  })

  it('missing status: an Error badge when the row stored an error, otherwise no badge', async () => {
    const f = await helper()
    expect(f(row('x', 'grpc', undefined, 'connect ECONNREFUSED'), tEn)).toMatchObject({
      label: 'Error',
      color: 'var(--red)',
      failed: true,
      title: 'connect ECONNREFUSED',
    })
    expect(f(row('x', 'grpc', undefined), tEn)).toBeNull()
  })
})

describe('Recent endpoints (new-request page) and the History sidebar', () => {
  for (const [locale, word] of [
    ['en', 'Error'],
    ['tr', 'Hata'],
  ] as const) {
    it(`a failed MQTT connect reads "${word}" in the danger colour, never "-1" (${locale})`, () => {
      useLocale(locale)
      const entries = [row('mq', 'mqtt', -1, 'connect ECONNREFUSED'), row('ok', 'http', 200)]
      useHistoryStore.setState({
        entries,
        searchTerm: '',
        fetch: vi.fn(async () => undefined),
      } as never)

      render(<NewRequestWelcome />)
      const welcomeRow = screen.getByText(/mqtt:\/\/127\.0\.0\.1:9\/mq/).closest('button')!
      const badge = within(welcomeRow).getByText(word)
      expect(badge.getAttribute('style') ?? '').toMatch(/var\(--red\)/)
      expect(within(welcomeRow).queryByText('-1')).toBeNull()
      cleanup()

      render(<HistoryListPanel />)
      const sideRow = screen
        .getAllByTestId('history-entry')
        .find((r) => /127\.0\.0\.1:9\/mq/.test(r.textContent ?? ''))!
      const sideBadge = within(sideRow).getByText(word)
      expect(sideBadge.getAttribute('style') ?? '').toMatch(/var\(--red\)/)
      expect(within(sideRow).queryByText('-1')).toBeNull()
    })
  }

  it('no hex colours or local statusColor copies left on these surfaces', () => {
    for (const file of [
      'src/renderer/components/layout/NewRequestWelcome.tsx',
      'src/renderer/components/sidebar/HistoryListPanel.tsx',
      'src/renderer/components/modals/HistoryPanel.tsx',
    ]) {
      const src = readFileSync(resolve(__dirname, '../..', file), 'utf8')
      expect(src, file).not.toMatch(/function statusColor/)
      expect(src, file).not.toMatch(/#cc2200|#b35a00/)
      expect(src, file).toMatch(/historyStatusDisplay/)
    }
  })
})
