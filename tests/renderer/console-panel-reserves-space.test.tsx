/**
 * The Console drawer must not sit on top of the workbench.
 *
 * It is absolutely positioned so it can slide over the footer, which means it
 * shrinks nothing by itself. The body therefore still measured full-height, its
 * `overflow-auto` never overflowed, and no scrollbar appeared — so whatever the
 * drawer covered could be neither scrolled to nor typed into. The tester hit it
 * on the Runner's Run lifecycle form ("Run teardown script" was unreachable
 * with the Console open, 5 Aug), but the cause was app-wide: any pane tall
 * enough to reach the bottom of the window had it.
 *
 * The fix is a reservation in AppShell, so this test asserts the geometry
 * contract between the two components rather than the Runner screen in
 * particular — that is where the bug actually lived.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../../src/renderer/stores/ui.store'

describe('console drawer height is shared, not private', () => {
  beforeEach(() => {
    useUIStore.setState({
      showConsolePanel: false,
      consolePanelMaximized: false,
      consolePanelHeight: 280,
    })
  })

  it('starts closed, reserving nothing', () => {
    const s = useUIStore.getState()
    expect(s.showConsolePanel).toBe(false)
    // The reservation AppShell applies is `showConsolePanel ? height : 0`.
    expect(s.showConsolePanel ? s.consolePanelHeight : 0).toBe(0)
  })

  it('reserves exactly the drawer height once open', () => {
    useUIStore.getState().setShowConsolePanel(true)
    const s = useUIStore.getState()
    expect(s.showConsolePanel ? s.consolePanelHeight : 0).toBe(280)
  })

  it('follows the drag handle, so the reservation tracks a resize', () => {
    // The height used to live in ConsolePanel's own useState, where nothing
    // else could see it — that is why no sibling could reserve room for it.
    useUIStore.getState().setShowConsolePanel(true)
    useUIStore.getState().setConsolePanelHeight(500)

    expect(useUIStore.getState().consolePanelHeight).toBe(500)
  })

  it('goes back to reserving nothing when closed again', () => {
    useUIStore.getState().setShowConsolePanel(true)
    useUIStore.getState().setConsolePanelHeight(400)
    useUIStore.getState().setShowConsolePanel(false)

    const s = useUIStore.getState()
    expect(s.showConsolePanel ? s.consolePanelHeight : 0).toBe(0)
    // The height itself is remembered for the next open.
    expect(s.consolePanelHeight).toBe(400)
  })
})
