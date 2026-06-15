/**
 * src/shared/script/aliases.ts — buildInsomnia(ctx) and buildBruno(ctx).
 * Verifies the two Insomnia semantic traps (numeric response.status,
 * baseEnvironment→collection vars) and Bruno's getter-method mapping.
 */
import { describe, it, expect as vi } from 'vitest'
import { buildInsomnia, buildBruno } from '../../../src/shared/script/aliases'
import { makeFakePm, json200 } from './helpers'
import type { PmLike } from '../../../src/shared/script/pm-types'

describe('buildInsomnia — response.status is NUMERIC (the key trap)', () => {
  it('insomnia.response.status === normalized code while pm.response.status is reason', () => {
    const fake = makeFakePm({ response: json200 })
    const insomnia = buildInsomnia(fake.ctx) as { response: { status: number } }
    vi(insomnia.response.status).toBe(200)
    vi(typeof insomnia.response.status).toBe('number')
    // pm side keeps reason text on .status
    vi(fake.pm.response?.status).toBe('OK')
    vi(fake.pm.response?.code).toBe(200)
  })
  it('insomnia.response is null in pre-request scope', () => {
    const fake = makeFakePm({ response: null })
    const insomnia = buildInsomnia(fake.ctx) as { response: unknown }
    vi(insomnia.response).toBeNull()
  })
})

describe('buildInsomnia — baseEnvironment / collectionVariables', () => {
  it('baseEnvironment === pm.collectionVariables === insomnia.collectionVariables', () => {
    const fake = makeFakePm()
    const insomnia = buildInsomnia(fake.ctx) as {
      baseEnvironment: unknown
      collectionVariables: unknown
    }
    vi(insomnia.baseEnvironment).toBe(fake.pm.collectionVariables)
    vi(insomnia.collectionVariables).toBe(fake.pm.collectionVariables)
    vi(insomnia.baseEnvironment).toBe(insomnia.collectionVariables)
  })
})

describe('buildInsomnia — environment delegates to pm', () => {
  it('set via insomnia, read via pm (and vice versa)', () => {
    const fake = makeFakePm({ envInit: { existing: 'E0' } })
    const insomnia = buildInsomnia(fake.ctx) as unknown as PmLike
    insomnia.environment.set('via-insomnia', 'V1')
    vi(fake.pm.environment.get('via-insomnia')).toBe('V1')
    fake.pm.environment.set('via-pm', 'V2')
    vi(insomnia.environment.get('via-pm')).toBe('V2')
    vi(insomnia.environment.get('existing')).toBe('E0')
  })
})

describe('buildInsomnia — inherits pm members & expect', () => {
  it('insomnia.expect works (chai)', () => {
    const fake = makeFakePm()
    const insomnia = buildInsomnia(fake.ctx) as unknown as PmLike
    vi(() => insomnia.expect(200).to.equal(200)).not.toThrow()
    vi(() => insomnia.expect(200).to.equal(404)).toThrow()
  })
  it('insomnia.test delegates to pm.test sink', () => {
    const fake = makeFakePm()
    const insomnia = buildInsomnia(fake.ctx) as unknown as PmLike
    insomnia.test('inherited test', () => {
      insomnia.expect(1).to.equal(1)
    })
    vi(fake.sink).toContainEqual({ name: 'inherited test', passed: true })
  })
})

describe('buildBruno — bru env/var scope mapping', () => {
  const fake = makeFakePm({ collectionInit: { cv: 'CV0' } })
  const { bru } = buildBruno(fake.ctx) as {
    bru: {
      getEnvVar(k: string): unknown
      setEnvVar(k: string, v: unknown): void
      hasEnvVar(k: string): boolean
      deleteEnvVar(k: string): void
      getEnvName(): unknown
      getVar(k: string): unknown
      setVar(k: string, v: unknown): void
      getCollectionVar(k: string): unknown
      setCollectionVar(k: string, v: unknown): void
      getGlobalEnvVar(k: string): unknown
      setGlobalEnvVar(k: string, v: unknown): void
      interpolate(s: string): string
      setNextRequest(name: string | null): void
    }
  }

  it('getEnvVar/setEnvVar ↔ pm.environment', () => {
    bru.setEnvVar('apiKey', 'K1')
    vi(fake.pm.environment.get('apiKey')).toBe('K1')
    vi(bru.getEnvVar('apiKey')).toBe('K1')
    vi(bru.hasEnvVar('apiKey')).toBe(true)
    bru.deleteEnvVar('apiKey')
    vi(fake.pm.environment.has('apiKey')).toBe(false)
  })
  it('getEnvName reflects environment.name', () => {
    vi(bru.getEnvName()).toBe('Development')
  })
  it('getVar/setVar ↔ pm.variables', () => {
    bru.setVar('runtime', 'R1')
    vi(fake.pm.variables.get('runtime')).toBe('R1')
    vi(bru.getVar('runtime')).toBe('R1')
  })
  it('getCollectionVar/setCollectionVar ↔ pm.collectionVariables', () => {
    vi(bru.getCollectionVar('cv')).toBe('CV0')
    bru.setCollectionVar('cv2', 'CV2')
    vi(fake.pm.collectionVariables.get('cv2')).toBe('CV2')
  })
  it('global env var helpers ↔ pm.globals', () => {
    bru.setGlobalEnvVar('gg', 'GG')
    vi(fake.pm.globals.get('gg')).toBe('GG')
    vi(bru.getGlobalEnvVar('gg')).toBe('GG')
  })
  it('interpolate uses pm.variables.replaceIn', () => {
    fake.pm.variables.set('host', 'api.test')
    vi(bru.interpolate('https://{{host}}/v1')).toBe('https://api.test/v1')
  })
  it('setNextRequest delegates to execution', () => {
    bru.setNextRequest('Next')
    vi(fake.nextRequest.value).toBe('Next')
  })
})

describe('buildBruno — req getters', () => {
  it('getUrl / getMethod / getName / getHeader (case-insensitive)', () => {
    const fake = makeFakePm({
      request: {
        method: 'PUT',
        url: 'https://x/y',
        name: 'Update',
        headers: { 'Content-Type': 'application/json' },
      },
    })
    const { req } = buildBruno(fake.ctx) as {
      req: {
        getUrl(): string
        getMethod(): string
        getName(): unknown
        getHeader(name: string): unknown
        getHeaders(): unknown
      }
    }
    vi(req.getUrl()).toBe('https://x/y')
    vi(req.getMethod()).toBe('PUT')
    vi(req.getName()).toBe('Update')
    vi(req.getHeader('content-type')).toBe('application/json')
    vi(req.getHeader('missing')).toBeUndefined()
    vi(req.getHeaders()).toEqual({ 'Content-Type': 'application/json' })
  })
})

describe('buildBruno — res getters (200 JSON)', () => {
  const fake = makeFakePm({ response: json200 })
  const { res } = buildBruno(fake.ctx) as {
    res: {
      status: number
      statusText: string
      responseTime: number
      headers: Record<string, string>
      body: unknown
      getStatus(): number
      getStatusText(): string
      getResponseTime(): number
      getBody(): unknown
      getHeader(name: string): unknown
      getHeaders(): Record<string, string>
      getSize(): unknown
    } | null
  }

  it('status / getStatus are NUMERIC code', () => {
    vi(res?.status).toBe(200)
    vi(res?.getStatus()).toBe(200)
  })
  it('statusText / getStatusText are reason', () => {
    vi(res?.statusText).toBe('OK')
    vi(res?.getStatusText()).toBe('OK')
  })
  it('getBody / body return parsed JSON object', () => {
    vi(res?.getBody()).toEqual({ id: 1, name: 'Ada', tags: ['x', 'y'] })
    vi(res?.body).toEqual({ id: 1, name: 'Ada', tags: ['x', 'y'] })
  })
  it('getResponseTime', () => {
    vi(res?.getResponseTime()).toBe(json200.responseTime)
  })
  it('getHeader is case-insensitive via pm.response', () => {
    vi(res?.getHeader('content-type')).toBe('application/json')
  })
  it('getHeaders returns a copy of headers', () => {
    vi(res?.getHeaders()).toEqual(json200.headers)
  })
  it('getSize delegates to pm.response.size()', () => {
    const size = res?.getSize() as { body: number; total: number }
    vi(size.body).toBe(json200.responseSize)
  })
})

describe('buildBruno — res getBody falls back to raw text for non-JSON', () => {
  it('returns the raw string when body is not JSON', () => {
    const fake = makeFakePm({
      response: {
        code: 200,
        statusText: 'OK',
        headers: {},
        body: 'plain',
        cookies: [],
        responseTime: 1,
        responseSize: 5,
      },
    })
    const { res } = buildBruno(fake.ctx) as { res: { getBody(): unknown; body: unknown } | null }
    vi(res?.getBody()).toBe('plain')
    vi(res?.body).toBe('plain')
  })
})

describe('buildBruno — res is null in pre-request scope', () => {
  it('returns null res when no response', () => {
    const fake = makeFakePm({ response: null })
    const { res } = buildBruno(fake.ctx)
    vi(res).toBeNull()
  })
})
