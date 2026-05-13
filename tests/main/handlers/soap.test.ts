/**
 * Smoke tests for `wsdl:*` and `soap:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

vi.mock('../../../src/main/protocols/soap.engine', () => ({
  parseWsdl: vi.fn(async () => ({ operations: [], services: [] })),
  parseWsdlFromContent: vi.fn(async () => ({ operations: [], services: [] })),
  executeSoap: vi.fn(async () => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '<Envelope><Body><Ok/></Body></Envelope>',
    bodySize: 30,
    timing: { total: 5 },
    actualRequest: { headers: {}, body: '<req/>' },
  })),
  generateEnvelope: vi.fn(() => '<Envelope/>'),
}))

const { registerSoapHandlers } = await import('../../../src/main/ipc/soap.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  registerSoapHandlers()
})

describe('wsdl:parse + wsdl:parseFile', () => {
  it('parses a WSDL URL into operations', async () => {
    const res = (await harness.invoke('wsdl:parse', 'http://example/wsdl')) as {
      success: boolean
      data?: { operations: unknown[] }
    }
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data?.operations)).toBe(true)
  })

  it('parses inline WSDL content', async () => {
    const res = (await harness.invoke('wsdl:parseFile', '<definitions/>')) as {
      success: boolean
      data?: unknown
    }
    expect(res.success).toBe(true)
  })

  it('surfaces parser errors', async () => {
    const { parseWsdl } = await import('../../../src/main/protocols/soap.engine')
    ;(parseWsdl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad-wsdl'))
    const res = (await harness.invoke('wsdl:parse', 'http://x')) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/bad-wsdl/)
  })
})

describe('soap:execute + soap:generateEnvelope', () => {
  it('executes a SOAP request and returns response envelope', async () => {
    const res = (await harness.invoke('soap:execute', {
      wsdlUrl: 'http://example/wsdl',
      endpointUrl: 'http://example/svc',
      operationName: 'Add',
      soapVersion: '1.1',
      params: { a: 1, b: 2 },
    })) as { success: boolean; data?: { status: number } }
    expect(res.success).toBe(true)
    expect(res.data?.status).toBe(200)
  })

  it('generates an envelope string', async () => {
    const res = (await harness.invoke('soap:generateEnvelope', {
      operationName: 'Op',
      params: {},
      soapVersion: '1.2',
    })) as { success: boolean; data?: string }
    expect(res.success).toBe(true)
    expect(typeof res.data).toBe('string')
  })
})
