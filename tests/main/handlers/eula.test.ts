/**
 * Smoke tests for `eula:*` IPC handlers.
 *
 * We replace the underlying `eula-consent` lib with deterministic stubs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let state = {
  accepted: false,
  acceptedAt: 0,
  acceptedVersion: '',
  acceptedDocsHash: '',
}
let clearError = false

vi.mock('../../../src/main/lib/eula-consent', () => ({
  getConsentState: async () => state,
  hashDocs: () => 'hash-abc',
  setAccepted: async (version: string, hash: string) => {
    state = {
      accepted: true,
      acceptedAt: Date.now(),
      acceptedVersion: version,
      acceptedDocsHash: hash,
    }
    return state
  },
  clearConsent: async () => {
    if (clearError) throw new Error('cannot clear')
    state = {
      accepted: false,
      acceptedAt: 0,
      acceptedVersion: '',
      acceptedDocsHash: '',
    }
  },
  isConsentValid: (s: { accepted: boolean }, _hash: string) => s.accepted,
}))

const { registerEulaHandlers } = await import('../../../src/main/ipc/eula.handler')

beforeEach(() => {
  harness.reset()
  state = {
    accepted: false,
    acceptedAt: 0,
    acceptedVersion: '',
    acceptedDocsHash: '',
  }
  clearError = false
  registerEulaHandlers()
})

describe('eula:state', () => {
  it('returns the consent state envelope', async () => {
    const res = (await harness.invoke('eula:state')) as {
      success: boolean
      data?: { state: { accepted: boolean }; currentDocsHash: string }
    }
    expect(res.success).toBe(true)
    expect(res.data?.state.accepted).toBe(false)
    expect(res.data?.currentDocsHash).toBe('hash-abc')
  })
})

describe('eula:accept + reset', () => {
  it('marks acceptance and the state flips to accepted=true', async () => {
    const acc = (await harness.invoke('eula:accept')) as {
      success: boolean
      data?: { accepted: boolean }
    }
    expect(acc.success).toBe(true)
    expect(acc.data?.accepted).toBe(true)

    const st = (await harness.invoke('eula:state')) as {
      data?: { state: { accepted: boolean }; consentValid: boolean }
    }
    expect(st.data?.state.accepted).toBe(true)
    expect(st.data?.consentValid).toBe(true)
  })

  it('resets consent', async () => {
    await harness.invoke('eula:accept')
    const res = (await harness.invoke('eula:reset')) as { success: boolean }
    expect(res.success).toBe(true)
  })

  it('reset returns error envelope on clear failure', async () => {
    clearError = true
    const res = (await harness.invoke('eula:reset')) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/cannot clear/)
  })
})
