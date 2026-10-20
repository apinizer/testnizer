/**
 * SSE connection bar (issue #221 screenshot review): the status pill is the
 * MCP bar's token pill (no hex that stays light in dark mode), the labels are
 * translated, and the reason a stream ended stays visible after the tab left
 * "Connected" — before, the message only rendered in the `error` state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import SseConnectionBar from '../../src/renderer/components/protocols/SseConnectionBar'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

function show(patch: Partial<ReturnType<typeof useSseStore.getState>>): void {
  useSseStore.setState({ url: 'http://127.0.0.1:3200/events', method: 'GET', ...patch })
  render(React.createElement(SseConnectionBar))
}

beforeEach(() => useUIStore.getState().setLocale('en'))
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('SseConnectionBar', () => {
  it('disconnected by the server: Connect + the close reason, neutral tone', () => {
    show({
      connectionState: 'disconnected',
      errorMessage: 'The server closed the stream (HTTP 204)',
    })
    const status = screen.getByTestId('sse-status')
    expect(status).toHaveAttribute('data-state', 'disconnected')
    expect(status.className).toContain('bg-[var(--surface)]')
    expect(screen.getByTestId('sse-connect')).toHaveTextContent('Connect')
    const msg = screen.getByTestId('sse-message')
    expect(msg).toHaveTextContent('The server closed the stream (HTTP 204)')
    expect(msg).toHaveAttribute('role', 'status')
    expect(msg.className).not.toMatch(/red-|#/)
  })

  it('error: the red token box, role alert', () => {
    show({ connectionState: 'error', errorMessage: 'HTTP 404 Not Found — check the SSE URL' })
    const msg = screen.getByTestId('sse-message')
    expect(msg).toHaveAttribute('role', 'alert')
    expect(msg.className).toContain('bg-[var(--mb-delete-bg)]')
  })

  it('connected: green token pill, Disconnect + Reconnect, a transient error is not shown', () => {
    show({ connectionState: 'connected', errorMessage: 'SSE connection error' })
    const status = screen.getByTestId('sse-status')
    expect(status).toHaveTextContent('Connected')
    expect(status.className).toContain('bg-[var(--green-bg)]')
    expect(status.getAttribute('style')).toBeNull()
    expect(screen.getByTestId('sse-disconnect')).toHaveTextContent('Disconnect')
    expect(screen.getByTestId('sse-reconnect')).toHaveTextContent('Reconnect')
    expect(screen.getByTestId('sse-method')).toBeDisabled()
    expect(screen.queryByTestId('sse-message')).toBeNull()
  })

  it('Turkish labels', () => {
    useUIStore.getState().setLocale('tr')
    show({ connectionState: 'connected', errorMessage: null })
    expect(screen.getByTestId('sse-status')).toHaveTextContent('Bağlı')
    expect(screen.getByTestId('sse-disconnect')).toHaveTextContent('Bağlantıyı Kes')
    expect(screen.getByTestId('sse-reconnect')).toHaveTextContent('Yeniden bağlan')
  })
})
