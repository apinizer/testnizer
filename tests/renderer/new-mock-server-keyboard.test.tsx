/**
 * "New mock server" dialog — keyboard (issue #226, WAI-ARIA radio group).
 *
 * The type switch and the preset list are radio groups: only the checked
 * radio is in the Tab order (roving tabindex), the arrow keys move AND
 * select (wrapping at the ends), Home / End go to the first / last radio.
 * The Tab order of the dialog is then type → preset → Name → Port →
 * Cancel → Create (the header's Close button comes first in the cycle).
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { resetHttpBridge } from './mock-http-bridge-stub'
import { installBridge } from './mock-mcp-bridge-stub'
import NewMockServerModal from '../../src/renderer/components/mock/NewMockServerModal'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'

void React

beforeEach(async () => {
  setLocale('en')
  resetHttpBridge([])
  installBridge([])
  useMockStore.setState({ servers: [], statusByServer: {}, errorByServer: {} })
  useMockMcpStore.setState({ servers: [], projectId: 'p-1' })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
})
afterEach(() => cleanup())

const typeRadio = (k: string): HTMLElement => screen.getByTestId(`mock-new-type-${k}`)
const preset = (id: string): HTMLElement => screen.getByTestId(`mock-new-preset-${id}`)
const presetRadios = (): HTMLElement[] =>
  within(screen.getByTestId('mock-new-presets')).getAllByRole('radio')
const key = (el: HTMLElement, k: string): void => {
  act(() => {
    fireEvent.keyDown(el, { key: k })
  })
}

/** Tabbable elements of the dialog, in document (= Tab) order. */
function tabOrder(): string[] {
  const dialog = screen.getByTestId('mock-new-dialog')
  const all = dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')
  return [...all]
    .filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0)
    .map((el) => el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName)
}

describe('New mock server dialog — radio group keyboard (issue #226)', () => {
  it('roving tabindex: only the checked radio of each group is tabbable', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    expect(typeRadio('http').tabIndex).toBe(0)
    for (const k of ['mcp', 'sse', 'ai']) expect(typeRadio(k).tabIndex).toBe(-1)
    const tabbable = presetRadios().filter((r) => r.tabIndex === 0)
    expect(tabbable).toEqual([preset('blank')])
  })

  it('Tab order: Close, type, preset, Name, Port, Cancel, Create', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    expect(tabOrder()).toEqual([
      'Close',
      'mock-new-type-http',
      'mock-new-preset-blank',
      'mock-new-name',
      'mock-new-port',
      'mock-new-cancel',
      'mock-new-create',
    ])
  })

  it('type switch: ArrowRight / ArrowDown move + select, ArrowLeft wraps, Home / End', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    typeRadio('http').focus()
    key(typeRadio('http'), 'ArrowRight')
    expect(typeRadio('mcp')).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(typeRadio('mcp'))
    expect(typeRadio('mcp').tabIndex).toBe(0)
    expect(typeRadio('http').tabIndex).toBe(-1)
    // The preset list follows the type.
    expect(preset('echo')).toHaveAttribute('aria-checked', 'true')

    key(typeRadio('mcp'), 'ArrowDown')
    expect(typeRadio('sse')).toHaveAttribute('aria-checked', 'true')
    key(typeRadio('sse'), 'End')
    expect(typeRadio('ai')).toHaveAttribute('aria-checked', 'true')
    key(typeRadio('ai'), 'ArrowRight') // wraps to the first
    expect(typeRadio('http')).toHaveAttribute('aria-checked', 'true')
    key(typeRadio('http'), 'ArrowLeft') // wraps to the last
    expect(typeRadio('ai')).toHaveAttribute('aria-checked', 'true')
    key(typeRadio('ai'), 'Home')
    expect(typeRadio('http')).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(typeRadio('http'))
  })

  it('preset list: ArrowDown / ArrowUp move + select, End / Home, focus follows', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    const ids = presetRadios().map((r) => r.getAttribute('data-testid'))
    expect(ids[0]).toBe('mock-new-preset-blank')
    preset('blank').focus()
    key(preset('blank'), 'ArrowDown')
    const second = presetRadios()[1]
    expect(second).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(second)
    expect(second.tabIndex).toBe(0)
    expect(preset('blank').tabIndex).toBe(-1)

    key(second, 'ArrowUp')
    expect(preset('blank')).toHaveAttribute('aria-checked', 'true')
    key(preset('blank'), 'ArrowUp') // wraps to the last
    const last = presetRadios()[presetRadios().length - 1]
    expect(last).toHaveAttribute('aria-checked', 'true')
    key(last, 'Home')
    expect(preset('blank')).toHaveAttribute('aria-checked', 'true')
    key(preset('blank'), 'End')
    expect(presetRadios()[presetRadios().length - 1]).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(presetRadios()[presetRadios().length - 1])
  })

  it('other keys are left alone (Tab is not swallowed)', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      typeRadio('http').dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(false)
    expect(typeRadio('http')).toHaveAttribute('aria-checked', 'true')
  })
})
