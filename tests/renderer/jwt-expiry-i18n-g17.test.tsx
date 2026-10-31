/**
 * 1.6.0 screen review G-17 follow-up — the JWT claims editor's expiry badge
 * was an English sentence in a Turkish UI ("expires in 1h 2m",
 * "expired 1d 1h ago"). The lib keeps its English `text` (pinned by
 * jwt-lifecycle.test.ts); the component words it per locale.
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ClaimsEditor from '../../src/renderer/components/tools/jwt/ClaimsEditor'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'

const NOW = 1_700_000_000

const useLocale = (l: 'en' | 'tr'): void => {
  useUIStore.setState({ locale: l })
  setLocale(l)
}

afterEach(() => {
  cleanup()
  useLocale('en')
})

function mount(exp?: number): void {
  render(
    <ClaimsEditor
      edits={{}}
      onChange={vi.fn()}
      previewPayload={exp === undefined ? {} : { exp }}
      nowSeconds={NOW}
    />,
  )
}

describe('JWT expiry badge follows the UI language', () => {
  it('EN keeps the existing sentences', () => {
    mount(NOW + 3725)
    expect(screen.getByText('expires in 1h 2m')).toBeTruthy()
    cleanup()
    mount(NOW - 90000)
    expect(screen.getByText('expired 1d 1h ago')).toBeTruthy()
  })

  it('TR: no English sentence, Turkish units', () => {
    useLocale('tr')
    mount(NOW + 3725)
    expect(screen.getByText('1sa 2dk sonra sona eriyor')).toBeTruthy()
    cleanup()
    mount(NOW - 90000)
    expect(screen.getByText('1g 1sa önce sona erdi')).toBeTruthy()
    cleanup()
    mount()
    expect(screen.queryByText(/expires|expired|no expiry/)).toBeNull()
    expect(screen.getByText('Son kullanma yok (exp alanı yok)')).toBeTruthy()
  })
})
