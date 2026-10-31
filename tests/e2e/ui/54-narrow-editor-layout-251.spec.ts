/**
 * Issue #251 — the HTTP editor at 900 / 1024 px: with the default 300 px
 * sidebar and the Variables panel open the URL input was 39 px (26 px at 16 px
 * font) wide, Send overlapped it, request sub-tabs were clipped and Key/Value
 * columns wrapped.
 *
 * Fix under test: the right panel collapses by itself while the editor would
 * be narrower than the threshold (NOT persisted — the user's preference stays),
 * the URL bar's secondary action (Save) moves into an overflow menu when the
 * bar itself is narrow, sub-tabs scroll, Key/Value header labels do not wrap.
 *
 * Scenario for every size: Turkish UI, 16 px font, 300 px sidebar, Variables
 * panel OPEN as the user's preference (opened at 1400 px, then the window is
 * shrunk — exactly how a user hits it).
 *
 * Contract testids: url-bar, url-input, send-btn, url-method, save-btn,
 * url-more-btn / url-more-menu / url-more-save, req-tab-strip, req-tab-<key>,
 * kv-header, right-panel, right-panel-rail(-variables), right-panel-collapse,
 * workbench-main-row, workbench-editor-column, right-panel[data-mode=docked|overlay]
 * (see tests/renderer/*-251/257 headers; overlay: right-panel-overlay-251).
 *
 * Pixel budget the numbers rely on (16 px font, TR): at 900 px: 900 - 83 icon
 * sidebar - 300 left panel = 517; the collapsed rail takes 40 -> 477 px for the
 * bar: 24 padding + 90 method + ~123 Send split + 34 overflow button leaves
 * ~206 px for the URL, so the >= 200 px floor is reachable but TIGHT there:
 * keep the method pill's min-width and the Send paddings as small as the
 * contract allows in compact mode. If it cannot be met, lower the floor in
 * THIS spec to the measured value and say so in the PR — do not hide the bar.
 *
 * `--list` only in the authoring pass; run by the orchestrator after a build.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { clickRequestTab } from '../helpers/ui/request-flow'
import {
  boxOf,
  emulateFontSize,
  overlaps,
  persistedRightPanelCollapsed,
  restoreEnglishLocale,
  restoreFontSize,
  setContentSize,
  setRightPanelOpen,
  switchToTurkish,
} from '../helpers/ui/layout-extra'
import { rightPanelMode } from '../../../src/renderer/lib/narrow-layout'

const SIZES = [
  { width: 900, height: 700 },
  { width: 1024, height: 700 },
] as const

uiTest.describe('Issue #251 — narrow request editor', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  for (const size of SIZES) {
    uiTest(
      `${size.width}x${size.height}, TR, 16px, 300px sidebar, Variables open: URL usable, no overlap`,
      async ({ app, window }) => {
        const original = await setContentSize(app, window, 1400, 900)
        const font = await emulateFontSize(window, 16)
        const wasOpen = await window
          .getByTestId('right-panel')
          .isVisible()
          .catch(() => false)
        try {
          await switchToTurkish(window)
          await openHttpRequestTab(window)
          await expect(window.getByTestId('url-input')).toBeVisible()
          const left = await boxOf(window, 'left-panel')
          expect(Math.round(left.width)).toBeGreaterThanOrEqual(290)
          expect(Math.round(left.width)).toBeLessThanOrEqual(310)

          // The user's preference: Variables OPEN (set while the window is wide).
          await setRightPanelOpen(window, true)
          await expect(window.getByTestId('right-panel')).toBeVisible()

          await setContentSize(app, window, size.width, size.height)

          // Auto collapse: the rail replaces the panel, the preference is untouched.
          await expect(window.getByTestId('right-panel-rail')).toBeVisible({ timeout: 5_000 })
          await expect(window.getByTestId('right-panel')).toHaveCount(0)
          expect(await persistedRightPanelCollapsed(window)).toBe(false)

          const url = await boxOf(window, 'url-input')
          const send = await boxOf(window, 'send-btn')
          const method = await boxOf(window, 'url-method')
          expect(url.width, 'URL input width').toBeGreaterThanOrEqual(200)
          expect(overlaps(url, send), 'Send overlaps the URL input').toBe(false)
          expect(overlaps(url, method), 'method overlaps the URL input').toBe(false)
          expect(send.x).toBeGreaterThanOrEqual(url.x + url.width - 1)
          // Nothing of the bar is pushed outside the window.
          expect(send.x + send.width).toBeLessThanOrEqual(size.width + 1)
          const bar = await boxOf(window, 'url-bar')
          expect(bar.x + bar.width).toBeLessThanOrEqual(size.width + 1)

          // Request sub-tabs: all seven exist; the active one is fully inside the strip;
          // the strip scrolls rather than clipping (reachable via wheel).
          const strip = window.getByTestId('req-tab-strip')
          const stripBox = (await strip.boundingBox())!
          const params = await boxOf(window, 'req-tab-params')
          expect(params.x).toBeGreaterThanOrEqual(stripBox.x - 1)
          expect(params.x + params.width).toBeLessThanOrEqual(stripBox.x + stripBox.width + 1)
          for (const key of ['params', 'headers', 'auth', 'body', 'scripts', 'tests', 'settings']) {
            await expect(window.getByTestId(`req-tab-${key}`)).toHaveCount(1)
          }
          const overflowing = await strip.evaluate((el) => el.scrollWidth > el.clientWidth)
          if (overflowing) {
            await strip.hover()
            await window.mouse.wheel(2000, 0)
            await expect
              .poll(() => strip.evaluate((el) => el.scrollLeft), { timeout: 3_000 })
              .toBeGreaterThan(0)
            await clickRequestTab(window, 'settings')
            const settings = await boxOf(window, 'req-tab-settings')
            const after = (await strip.boundingBox())!
            expect(settings.x + settings.width).toBeLessThanOrEqual(after.x + after.width + 1)
          }

          // Key/Value header labels stay on one line (Params table).
          await strip.evaluate((el) => (el.scrollLeft = 0))
          await window.getByTestId('req-tab-params').click()
          const header = window.getByTestId('kv-header').first()
          await expect(header).toBeVisible()
          const hb = (await header.boundingBox())!
          // One 16 px line + padding is ~30 px; a wrapped label doubles it.
          expect(hb.height, 'Key/Value header wrapped').toBeLessThanOrEqual(36)
          // 1.6.0 screen review: "DescriptionBulk Edit" glued and ran past its
          // cell. The toggle ("Toplu Düzenle" in TR) lies inside the header and
          // its cell does not overflow.
          const toggle = header.getByTestId('kv-bulk-toggle')
          if (await toggle.isVisible()) {
            const tb = (await toggle.boundingBox())!
            expect(tb.x + tb.width, 'Bulk Edit past the header').toBeLessThanOrEqual(
              hb.x + hb.width + 1,
            )
            const cellSpill = await toggle.evaluate((el) => {
              const cell = el.parentElement as HTMLElement
              return cell.scrollWidth - cell.clientWidth
            })
            expect(cellSpill, 'Description / Bulk Edit cell overflows').toBeLessThanOrEqual(1)
          }
        } finally {
          await setContentSize(app, window, original.width, original.height)
          await restoreEnglishLocale(window)
          await restoreFontSize(window, font)
          await setRightPanelOpen(window, wasOpen).catch(() => {})
          await closeAllTabs(window)
        }
      },
    )
  }

  uiTest(
    '900 px: Save lives in the overflow menu and still saves the request',
    async ({ app, window }) => {
      const original = await setContentSize(app, window, 900, 700)
      try {
        await openHttpRequestTab(window)
        await expect(window.getByTestId('save-btn')).toHaveCount(0)
        const more = window.getByTestId('url-more-btn')
        await expect(more).toBeVisible()
        await more.click()
        const save = window.getByTestId('url-more-save')
        await expect(save).toBeVisible()
        await expect(save).toBeInViewport()
        await save.click()
        // A never-saved tab opens the Save dialog, exactly like the wide Save button.
        await expect(window.getByTestId('endpoint-save-modal')).toBeVisible({ timeout: 5_000 })
        await window.keyboard.press('Escape')
      } finally {
        await dismissOverlays(window)
        await setContentSize(app, window, original.width, original.height)
        await closeAllTabs(window)
      }
    },
  )

  uiTest(
    'a wide window keeps the panel the user opened and the inline Save button',
    async ({ app, window }) => {
      const original = await setContentSize(app, window, 1400, 900)
      const wasOpen = await window
        .getByTestId('right-panel')
        .isVisible()
        .catch(() => false)
      try {
        await openHttpRequestTab(window)
        await setRightPanelOpen(window, true)
        await expect(window.getByTestId('right-panel')).toBeVisible()
        await expect(window.getByTestId('save-btn')).toBeVisible()
        await expect(window.getByTestId('url-more-btn')).toHaveCount(0)
        const url = await boxOf(window, 'url-input')
        expect(url.width).toBeGreaterThanOrEqual(240)
      } finally {
        await setRightPanelOpen(window, wasOpen).catch(() => {})
        await setContentSize(app, window, original.width, original.height)
        await closeAllTabs(window)
      }
    },
  )

  uiTest(
    'narrow: the user can still open the panel by hand, and it persists as a choice',
    async ({ app, window }) => {
      const original = await setContentSize(app, window, 1400, 900)
      const wasOpen = await window
        .getByTestId('right-panel')
        .isVisible()
        .catch(() => false)
      try {
        await openHttpRequestTab(window)
        await setRightPanelOpen(window, false)
        await setContentSize(app, window, 1024, 700)
        await expect(window.getByTestId('right-panel-rail')).toBeVisible()
        await window.getByTestId('right-panel-rail-variables').click()
        // The user's explicit click wins over the auto collapse.
        await expect(window.getByTestId('right-panel')).toBeVisible({ timeout: 5_000 })
        expect(await persistedRightPanelCollapsed(window)).toBe(false)

        // Review of #251: with the panel opened by hand the editor is only a
        // few hundred px wide. Docked, the panel is RENDERED no wider than
        // leaves the compact URL bar its budget (URL_BAR_MIN_BUDGET); a row
        // that cannot hold the budget next to even a 240 px panel (< 662 px,
        // `rightPanelMode`) draws the panel as an overlay drawer instead and
        // the editor keeps the full row. Either way the input keeps its
        // floor, never runs under Send, and Send / the overflow button stay
        // inside the bar. The stored width is untouched. At 1024 px with a
        // 300 px sidebar the row is ~641 -> overlay; with a narrower sidebar
        // it may dock — decided from the MEASURED row.
        const row = await boxOf(window, 'workbench-main-row')
        const stored = await window.evaluate(async () => {
          const w = window as unknown as Window & {
            api?: { settings?: { get: (k: string) => Promise<{ data?: unknown }> } }
          }
          const v = (await w.api?.settings?.get('ui.rightPanelWidth'))?.data
          return typeof v === 'number' ? v : 300
        })
        await expect(window.getByTestId('right-panel')).toHaveAttribute(
          'data-mode',
          rightPanelMode(row.width, stored),
        )
        const url = await boxOf(window, 'url-input')
        const send = await boxOf(window, 'send-btn')
        expect(url.width, 'URL input width').toBeGreaterThanOrEqual(159)
        expect(url.x + url.width, 'URL input runs under Send').toBeLessThanOrEqual(send.x + 1)
        expect(overlaps(url, send), 'Send overlaps the URL input').toBe(false)
        // boundingBox ignores clipping: Send must also lie inside the bar, not be
        // pushed past the editor column's overflow-hidden edge by the floor.
        const bar = await boxOf(window, 'url-bar')
        expect(send.x + send.width, 'Send pushed out of the URL bar').toBeLessThanOrEqual(
          bar.x + bar.width + 1,
        )
        const more = window.getByTestId('url-more-btn')
        if (await more.isVisible()) {
          const mb = await boxOf(window, 'url-more-btn')
          expect(mb.x + mb.width, 'overflow button pushed out of the URL bar').toBeLessThanOrEqual(
            bar.x + bar.width + 1,
          )
        }
        const spill = await window
          .getByTestId('url-bar')
          .evaluate((el) => el.scrollWidth - el.clientWidth)
        expect(spill, 'URL bar content overflows the bar').toBeLessThanOrEqual(1)
      } finally {
        await setContentSize(app, window, original.width, original.height)
        await setRightPanelOpen(window, wasOpen).catch(() => {})
        await closeAllTabs(window)
      }
    },
  )

  uiTest(
    '900x700, panel opened by hand: overlay drawer, nothing of the editor cut on the left',
    async ({ app, window }) => {
      const original = await setContentSize(app, window, 1400, 900)
      const wasOpen = await window
        .getByTestId('right-panel')
        .isVisible()
        .catch(() => false)
      try {
        await openHttpRequestTab(window)
        await setRightPanelOpen(window, false)
        await setContentSize(app, window, 900, 700)
        await expect(window.getByTestId('right-panel-rail')).toBeVisible()
        const row = await boxOf(window, 'workbench-main-row')
        // The screenshot's case: the row cannot dock even a minimum panel.
        expect(rightPanelMode(row.width, 300), `row ${row.width}`).toBe('overlay')

        await window.getByTestId('right-panel-rail-variables').click()
        const panel = window.getByTestId('right-panel')
        await expect(panel).toBeVisible({ timeout: 5_000 })
        await expect(panel).toHaveAttribute('data-mode', 'overlay')
        expect(await persistedRightPanelCollapsed(window)).toBe(false)
        // No resize handle on the drawer (the row's own child; the editor's
        // request/response split handle is a separator too).
        await expect(
          window.locator('[data-testid="workbench-main-row"] > [role="separator"]'),
        ).toHaveCount(0)

        // The bug: focus on the overflow button scrolled the overflow-hidden
        // editor column sideways. Reproduce the focus, then measure.
        const more = window.getByTestId('url-more-btn')
        if ((await more.count()) > 0) await more.focus()
        else await window.getByTestId('send-btn').focus()

        const scrolls = await window.evaluate(() => {
          const col = document.querySelector('[data-testid="workbench-editor-column"]')
          const r = document.querySelector('[data-testid="workbench-main-row"]')
          return {
            column: col?.scrollLeft ?? -1,
            row: r?.scrollLeft ?? -1,
            wrapper: r?.parentElement?.scrollLeft ?? -1,
          }
        })
        expect(scrolls, 'editor scrolled sideways').toEqual({ column: 0, row: 0, wrapper: 0 })

        const column = await boxOf(window, 'workbench-editor-column')
        // The editor keeps the full row under the drawer.
        expect(Math.abs(column.width - row.width), 'editor column width').toBeLessThanOrEqual(1)
        const method = await boxOf(window, 'url-method')
        expect(method.x, 'method dropdown cut on the left').toBeGreaterThanOrEqual(column.x - 1)
        await expect(window.getByTestId('url-input')).toBeVisible()
        const url = await boxOf(window, 'url-input')
        expect(url.x, 'URL input cut on the left').toBeGreaterThanOrEqual(column.x - 1)
        expect(url.width, 'URL input width').toBeGreaterThanOrEqual(159)
        const send = await boxOf(window, 'send-btn')
        const bar = await boxOf(window, 'url-bar')
        expect(send.x + send.width, 'Send pushed out of the URL bar').toBeLessThanOrEqual(
          bar.x + bar.width + 1,
        )
        expect(overlaps(url, send), 'Send overlaps the URL input').toBe(false)
        const strip = await boxOf(window, 'req-tab-strip')
        expect(strip.x, 'tab strip cut on the left').toBeGreaterThanOrEqual(column.x - 1)

        // Closing the drawer gives the normal layout back (rail docked on the right).
        await window.getByTestId('right-panel-collapse').click()
        await expect(window.getByTestId('right-panel-rail')).toBeVisible()
        await expect(panel).toHaveCount(0)
        const columnAfter = await boxOf(window, 'workbench-editor-column')
        const methodAfter = await boxOf(window, 'url-method')
        const urlAfter = await boxOf(window, 'url-input')
        const sendAfter = await boxOf(window, 'send-btn')
        const barAfter = await boxOf(window, 'url-bar')
        expect(methodAfter.x).toBeGreaterThanOrEqual(columnAfter.x - 1)
        expect(urlAfter.width).toBeGreaterThanOrEqual(159)
        expect(sendAfter.x + sendAfter.width).toBeLessThanOrEqual(barAfter.x + barAfter.width + 1)
        expect(overlaps(urlAfter, sendAfter)).toBe(false)
      } finally {
        await setContentSize(app, window, original.width, original.height)
        await setRightPanelOpen(window, wasOpen).catch(() => {})
        await closeAllTabs(window)
      }
    },
  )
})
