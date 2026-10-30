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
 * workbench-main-row (see tests/renderer/*-251/257 headers).
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
        // few hundred px wide. The URL's minimum sits on its outer flex item,
        // and the panel is RENDERED no wider than leaves the compact URL bar
        // its budget (URL_BAR_MIN_BUDGET, never under the 240 px panel
        // minimum; the stored width is untouched) — so the input keeps its
        // floor, never runs under Send, and Send / the overflow button stay
        // inside the bar. At 1024 px (row ~641) the minimum wins: the editor
        // gets 641 - 240 - 5 = 396 px, enough for this default-font EN bar.
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
})
