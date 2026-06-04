/**
 * Smoke tests for `wsse:*` IPC handlers.
 *
 * The underlying engine is exercised separately in
 * `tests/main/wsse-engine.test.ts`; here we only assert envelope shapes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

vi.mock('../../../src/main/protocols/wsse.engine', () => ({
  applyWsSecurity: vi.fn(async (envelope: string) => envelope.replace('</Envelope>', '<Sec/></Envelope>')),
  verifySignature: vi.fn(() => ({ valid: true })),
  decryptEnvelope: vi.fn(async (envelope: string) => envelope.toUpperCase()),
}))

const { registerWsseHandlers } = await import('../../../src/main/ipc/wsse.handler')

beforeEach(() => {
  harness.reset()
  registerWsseHandlers()
})

describe('wsse:apply', () => {
  it('returns success envelope with signed body', async () => {
    const res = (await harness.invoke('wsse:apply', {
      envelope: '<Envelope></Envelope>',
      config: { /* shape doesn't matter — engine is mocked */ },
    })) as { success: boolean; data?: string }
    expect(res.success).toBe(true)
    expect(res.data).toContain('<Sec/>')
  })

  it('returns error envelope when engine throws', async () => {
    const { applyWsSecurity } = await import('../../../src/main/protocols/wsse.engine')
    ;(applyWsSecurity as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad'))
    const res = (await harness.invoke('wsse:apply', {
      envelope: '',
      config: {},
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/bad/)
  })
})

describe('wsse:verify + wsse:decrypt', () => {
  it('verify returns success', async () => {
    const res = (await harness.invoke('wsse:verify', {
      envelope: '<E/>',
      certPem: '---',
    })) as { success: boolean; data?: { valid: boolean } }
    expect(res.success).toBe(true)
    expect(res.data?.valid).toBe(true)
  })

  it('decrypt returns success', async () => {
    const res = (await harness.invoke('wsse:decrypt', {
      envelope: '<e/>',
      privateKeyPem: '---',
    })) as { success: boolean; data?: string }
    expect(res.success).toBe(true)
    expect(res.data).toBe('<E/>')
  })

  it('decrypt surfaces engine errors', async () => {
    const { decryptEnvelope } = await import('../../../src/main/protocols/wsse.engine')
    ;(decryptEnvelope as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('bad-key'),
    )
    const res = (await harness.invoke('wsse:decrypt', {
      envelope: '<e/>',
      privateKeyPem: '---',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/bad-key/)
  })
})
