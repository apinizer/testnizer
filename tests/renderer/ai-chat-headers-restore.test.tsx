/**
 * Issue #187 — AI Chat custom headers after a reopen, and the "session only"
 * note for credential headers.
 *
 *  - `restoreAiConfig` must leave the headers in the editor's empty state (one
 *    blank row) when nothing is left to show — saved `[]`, an older row
 *    without headers, or every row a stripped credential — never `[]`.
 *  - A credential header (Authorization, *-Key, *-Token…) with a literal value
 *    works for this session but is not saved: the headers section says so and
 *    suggests a {{variable}}. A templated value or a blank one shows no note.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import {
  resetAiKeySessionForTests,
  restoreAiConfig,
  useAiChatStore,
} from '../../src/renderer/stores/ai-chat.store'
import { hasSessionOnlyCredentialHeader } from '../../src/renderer/lib/ai-chat-config'
import AiChatEditor from '../../src/renderer/components/protocols/AiChatEditor'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { KeyValuePair } from '../../src/renderer/types'

const row = (key: string, value: string, enabled = true): KeyValuePair => ({
  id: `${key}-${value}`,
  key,
  value,
  enabled,
})

const isBlankRow = (h: KeyValuePair): boolean => h.key === '' && h.value === '' && h.enabled

beforeEach(() => {
  resetAiKeySessionForTests()
  useAiChatStore.setState({ customHeaders: [row('X-Leftover', 'live')] })
})

afterEach(() => {
  cleanup()
  act(() => useUIStore.setState({ locale: 'en' }))
})

describe('issue #187 — restoreAiConfig keeps the editor empty state for headers', () => {
  const base = { provider: 'openai', model: 'gpt-5', customUrl: 'https://api.openai.com/v1/chat/completions' }

  it('saved [] → one blank row', () => {
    restoreAiConfig({ ...base, customHeaders: [] })
    const h = useAiChatStore.getState().customHeaders
    expect(h).toHaveLength(1)
    expect(isBlankRow(h[0])).toBe(true)
  })

  it('only credential rows (all stripped) → one blank row', () => {
    restoreAiConfig({ ...base, customHeaders: [row('Authorization', 'Bearer raw-SECRET')] })
    const h = useAiChatStore.getState().customHeaders
    expect(h).toHaveLength(1)
    expect(isBlankRow(h[0])).toBe(true)
  })

  it('an older row without customHeaders → one blank row, not the live tab\'s leftovers', () => {
    restoreAiConfig({ ...base })
    const h = useAiChatStore.getState().customHeaders
    expect(h).toHaveLength(1)
    expect(isBlankRow(h[0])).toBe(true)
  })

  it('kept rows are restored as saved', () => {
    restoreAiConfig({
      ...base,
      customHeaders: [row('X-Tenant', 'acme'), row('Authorization', 'Bearer {{token}}')],
    })
    expect(useAiChatStore.getState().customHeaders.map((h) => [h.key, h.value])).toEqual([
      ['X-Tenant', 'acme'],
      ['Authorization', 'Bearer {{token}}'],
    ])
  })
})

describe('issue #187 — credential header kept for this session only: inline note', () => {
  it('predicate: literal credential yes; template, blank or ordinary header no', () => {
    expect(hasSessionOnlyCredentialHeader([row('Authorization', 'Bearer raw')])).toBe(true)
    expect(hasSessionOnlyCredentialHeader([row('X-Api-Key', 'k-123', false)])).toBe(true)
    expect(hasSessionOnlyCredentialHeader([row('Authorization', 'Bearer {{token}}')])).toBe(false)
    expect(hasSessionOnlyCredentialHeader([row('Authorization', '   ')])).toBe(false)
    expect(hasSessionOnlyCredentialHeader([row('X-Tenant', 'acme')])).toBe(false)
    expect(hasSessionOnlyCredentialHeader([])).toBe(false)
  })

  it('shows in the headers section (EN + TR) and goes away with a {{variable}}', () => {
    act(() => useUIStore.setState({ locale: 'en' }))
    useAiChatStore.setState({ customHeaders: [row('X-Tenant', 'acme')] })
    render(<AiChatEditor />)
    expect(screen.queryByTestId('ai-headers-session-only-note')).toBeNull()

    act(() => useAiChatStore.setState({ customHeaders: [row('Authorization', 'Bearer raw-SECRET')] }))
    const note = screen.getByTestId('ai-headers-session-only-note')
    // Inside the headers section, visible while it is collapsed.
    expect(screen.getByTestId('ai-chat-headers').contains(note)).toBe(true)
    expect(note.textContent).toMatch(/kept for this session only and is not saved/)
    expect(note.textContent).toContain('{{variable}}')

    act(() => useUIStore.setState({ locale: 'tr' }))
    expect(screen.getByTestId('ai-headers-session-only-note').textContent).toMatch(
      /yalnızca bu oturum boyunca tutulur ve kaydedilmez/,
    )
    expect(screen.getByTestId('ai-headers-session-only-note').textContent).toContain('{{değişken}}')

    act(() => useAiChatStore.setState({ customHeaders: [row('Authorization', 'Bearer {{token}}')] }))
    expect(screen.queryByTestId('ai-headers-session-only-note')).toBeNull()
  })
})
