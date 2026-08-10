/**
 * Issue #69 — "Add Request → HTTP does not open the HTTP editor".
 *
 * The Workbench chose between the protocol picker and the editor with
 * `name === 'New Request' && !url`. The APIs tree's HTTP default was named
 * exactly that, so a freshly created — and PERSISTED — request rendered the
 * picker. Only HTTP tripped it because every other protocol's default name
 * differed, which is why the report reads as an HTTP-only bug.
 *
 * The discriminator is now identity-based, so the whole class is closed: no
 * tab that points at stored content can ever render the picker, whatever it is
 * called.
 */
import { describe, it, expect } from 'vitest'
import { isBlankScratchTab } from '../../src/renderer/lib/tab-kind'

const blank = {
  name: 'New Request',
  url: '',
  endpointId: undefined,
  savedRequestId: undefined,
  testSuiteItemId: undefined,
}

describe('isBlankScratchTab', () => {
  it('treats a truly empty scratch tab as blank (the picker case)', () => {
    expect(isBlankScratchTab(blank)).toBe(true)
  })

  it('never treats a saved request as blank — even when it is called "New Request"', () => {
    expect(isBlankScratchTab({ ...blank, savedRequestId: 'sr-1' })).toBe(false)
  })

  it('never treats an endpoint as blank — even when it is called "New Request"', () => {
    expect(isBlankScratchTab({ ...blank, endpointId: 'ep-1' })).toBe(false)
  })

  it('never treats a test-suite item as blank (the Tests-panel sibling path)', () => {
    expect(isBlankScratchTab({ ...blank, testSuiteItemId: 'tsi-1' })).toBe(false)
  })

  it('is not blank once the tab has a URL', () => {
    expect(isBlankScratchTab({ ...blank, url: 'https://example.test/x' })).toBe(false)
  })

  it('a differently named empty tab keeps its editor (no name collision left to exploit)', () => {
    expect(isBlankScratchTab({ ...blank, name: 'New Endpoint' })).toBe(false)
  })
})
