/// <reference types="react" />
/**
 * Issue #25 follow-up — the binary response preview must show a LIVE object URL.
 *
 * The first cut created the object URL during render (useMemo) and revoked it in
 * a separate `[url]` effect. Under React StrictMode (always on in dev) React
 * mounts, runs the effect cleanup once to flush out side-effect bugs, then
 * remounts — so the cleanup revoked the URL while the memo kept handing that
 * now-dead `blob:` URL to <img> / <a download>. Result: broken image, empty
 * download. The fix creates AND revokes the URL inside one effect, so a fresh
 * live URL survives the StrictMode remount.
 *
 * This test reproduces that: it renders <ResponseBody> under StrictMode with a
 * base64 image body and asserts the <img> src is a URL that was created and NOT
 * revoked. It fails against the old useMemo-create / effect-revoke pattern.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

;(globalThis as unknown as { React: typeof React }).React = React

// Stub Monaco (jsdom can't load the editor) but echo its `value` so the Raw
// toggle test can assert the base64 actually reaches the editor.
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>,
}))

import ResponseBody from '../../src/renderer/components/response/ResponseBody'
import { useResponseStore } from '../../src/renderer/stores/response.store'

// A 1×1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/IhTAAAAAElFTkSuQmCC'

const live = new Set<string>()
let counter = 0

beforeEach(() => {
  live.clear()
  counter = 0
  // jsdom does not implement object URLs — track create/revoke so the test can
  // assert the displayed URL is still live.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const u = `blob:mock/${++counter}`
      live.add(u)
      return u
    }),
    revokeObjectURL: vi.fn((u: string) => {
      live.delete(u)
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ResponseBody binary preview — object URL lifecycle (issue #25)', () => {
  it('renders an <img> whose blob URL is still live under StrictMode', async () => {
    useResponseStore.getState().setResponse({
      requestId: 'r1',
      protocol: 'http',
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: PNG_BASE64,
      bodyEncoding: 'base64',
      bodySize: 70,
      timing: { total: 1 },
    })

    render(
      <React.StrictMode>
        <ResponseBody />
      </React.StrictMode>,
    )

    const img = (await screen.findByAltText('Response')) as HTMLImageElement
    const src = img.getAttribute('src') ?? ''
    expect(src).toMatch(/^blob:mock\//)
    // The crux: the URL handed to <img> must NOT have been revoked.
    expect(live.has(src), `img src ${src} was revoked`).toBe(true)
  })

  it('the Download link points at the same live blob URL', async () => {
    useResponseStore.getState().setResponse({
      requestId: 'r2',
      protocol: 'http',
      status: 200,
      headers: { 'content-type': 'application/pdf' },
      body: PNG_BASE64,
      bodyEncoding: 'base64',
      bodySize: 70,
      timing: { total: 1 },
    })

    render(
      <React.StrictMode>
        <ResponseBody />
      </React.StrictMode>,
    )

    const link = (await screen.findByTestId('res-binary-download')) as HTMLAnchorElement
    await waitFor(() => expect(link.getAttribute('href')).toMatch(/^blob:mock\//))
    const href = link.getAttribute('href') ?? ''
    expect(live.has(href), `download href ${href} was revoked`).toBe(true)
    expect(link.getAttribute('download')).toBe('response.pdf')
  })

  it('toggles between the rendered image and the raw base64 (issue #25 follow-up)', async () => {
    useResponseStore.getState().setResponse({
      requestId: 'r3',
      protocol: 'http',
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: PNG_BASE64,
      bodyEncoding: 'base64',
      bodySize: 70,
      timing: { total: 1 },
    })

    render(
      <React.StrictMode>
        <ResponseBody />
      </React.StrictMode>,
    )

    // Default view renders the image.
    await screen.findByAltText('Response')

    // Switch to Raw — the base64 reaches the (stubbed) editor and the image is gone.
    fireEvent.click(screen.getByTestId('res-binary-view-raw'))
    const raw = await screen.findByTestId('res-binary-raw')
    expect(raw.textContent).toContain(PNG_BASE64)
    expect(screen.queryByAltText('Response')).toBeNull()

    // Back to Preview — the image returns.
    fireEvent.click(screen.getByTestId('res-binary-view-preview'))
    await screen.findByAltText('Response')
  })
})
