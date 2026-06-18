/**
 * Issue #15 — resizable left/right side panels. Guards the ui.store width
 * actions: live setters clamp to sane bounds and commit is callable.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../../src/renderer/stores/ui.store'

describe('ui.store panel widths (issue #15)', () => {
  beforeEach(() => {
    useUIStore.setState({ leftPanelWidth: 300, rightPanelWidth: 300 })
  })

  it('setLeftPanelWidth clamps to [200, 600]', () => {
    useUIStore.getState().setLeftPanelWidth(320)
    expect(useUIStore.getState().leftPanelWidth).toBe(320)
    useUIStore.getState().setLeftPanelWidth(50)
    expect(useUIStore.getState().leftPanelWidth).toBe(200)
    useUIStore.getState().setLeftPanelWidth(9999)
    expect(useUIStore.getState().leftPanelWidth).toBe(600)
  })

  it('setRightPanelWidth clamps to [240, 600]', () => {
    useUIStore.getState().setRightPanelWidth(420)
    expect(useUIStore.getState().rightPanelWidth).toBe(420)
    useUIStore.getState().setRightPanelWidth(10)
    expect(useUIStore.getState().rightPanelWidth).toBe(240)
    useUIStore.getState().setRightPanelWidth(9999)
    expect(useUIStore.getState().rightPanelWidth).toBe(600)
  })

  it('commitPanelWidths does not throw when no settings bridge is present', () => {
    useUIStore.getState().setLeftPanelWidth(360)
    useUIStore.getState().setRightPanelWidth(380)
    expect(() => useUIStore.getState().commitPanelWidths()).not.toThrow()
  })
})
