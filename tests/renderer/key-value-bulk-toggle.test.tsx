/// <reference types="react" />
import * as React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// JSX runtime shim (same as the other renderer tsx tests).
;(globalThis as unknown as { React: typeof React }).React = React

import KeyValueTable from '../../src/renderer/components/shared/KeyValueTable'
import type { KeyValuePair } from '../../src/renderer/types'

/**
 * issue #22 — the Bulk Edit toggle moved out of its own spacer row into the
 * table's Description header. This guards the relocation: the toggle must stay
 * reachable in BOTH table and bulk-edit mode (otherwise the user could enter
 * bulk mode and never get back), and the wasted spacer row above the table
 * must be gone.
 */
describe('KeyValueTable — Bulk Edit toggle placement (issue #22)', () => {
  const rows: KeyValuePair[] = [{ id: 'r1', key: 'a', value: '1', enabled: true }]

  beforeEach(() => cleanup())

  it('renders the toggle in the header (table mode) and round-trips to bulk mode and back', () => {
    render(
      <KeyValueTable
        rows={rows}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onAdd={vi.fn()}
        onReplaceAll={vi.fn()}
        flush
      />,
    )

    // Table mode: toggle present, no textarea yet.
    const toggle = screen.getByTestId('kv-bulk-toggle')
    expect(toggle).toBeTruthy()
    expect(screen.queryByTestId('kv-bulk-textarea')).toBeNull()

    // Enter bulk mode → textarea shows AND the toggle is still reachable.
    fireEvent.click(toggle)
    expect(screen.getByTestId('kv-bulk-textarea')).toBeTruthy()
    expect(screen.getByTestId('kv-bulk-toggle')).toBeTruthy()

    // Back to table mode → textarea gone.
    fireEvent.click(screen.getByTestId('kv-bulk-toggle'))
    expect(screen.queryByTestId('kv-bulk-textarea')).toBeNull()
  })

  it('hides the toggle entirely when no onReplaceAll handler is provided', () => {
    render(<KeyValueTable rows={rows} onUpdate={vi.fn()} onRemove={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.queryByTestId('kv-bulk-toggle')).toBeNull()
  })
})
