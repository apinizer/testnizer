/**
 * Shared `pm` factory (src/shared/script/pm.ts) and its request objects
 * (pm-request.ts) — issue #281. The parity fixture proves Send≡Run; these
 * units pin the pieces' own behaviour.
 */
import { describe, expect, it } from 'vitest'
import { createPm, isSkipRequestSignal } from '../../../src/shared/script/pm'
import { HeaderCollection } from '../../../src/shared/script/headers'
import { createPmRequestBody, PmUrl } from '../../../src/shared/script/pm-request'
import { buildPmSendResponse, normalizePmSendInput } from '../../../src/shared/script/send-request'

function makePm(overrides: Partial<Parameters<typeof createPm>[0]> = {}) {
  const logs: Array<{ level: string; message: string }> = []
  const env = new Map<string, string>()
  const envUpdates = new Map<string, string>()
  const runtime = createPm({
    eventName: 'test',
    scopes: {
      globals: { values: new Map() },
      environment: { values: env, updates: envUpdates },
      locals: { values: new Map() },
      data: { row: 'R1' },
    },
    request: { method: 'GET', url: 'https://h.test/p', headers: new HeaderCollection() },
    response: null,
    send: async () => ({ status: 200, body: '{}' }),
    log: (level, message) => logs.push({ level, message }),
    ...overrides,
  })
  return { runtime, pm: runtime.pm, logs, env, envUpdates }
}

describe('PmUrl', () => {
  it('keeps toString() byte-identical, placeholders included', () => {
    for (const raw of [
      '{{baseUrl}}/users/:id?x={{v}}',
      'http://localhost:3000/a%20b?q=a+b&empty&k=',
      'api.test/x',
      '',
    ]) {
      expect(new PmUrl(raw).toString()).toBe(raw)
    }
  })

  it('splits host, port, path, auth and hash like Postman', () => {
    const u = new PmUrl('https://user:pw@api.test:8443/v1/a?x=1#frag')
    expect(u.protocol).toBe('https')
    expect(u.host).toEqual(['api', 'test'])
    expect(u.getHost()).toBe('api.test')
    expect(u.port).toBe('8443')
    expect(u.getRemote()).toBe('api.test:8443')
    expect(u.path).toEqual(['v1', 'a'])
    expect(u.getPath()).toBe('/v1/a')
    expect(u.auth).toEqual({ user: 'user', password: 'pw' })
    expect(u.hash).toBe('frag')
    expect(new PmUrl('{{host}}:{{port}}/x').port).toBe('{{port}}')
  })

  it('query list reads and edits; toString follows an edit', () => {
    const u = new PmUrl('https://a.test/p?a=1&a=2&b=x#h')
    expect(u.query.get('a')).toBe('2')
    expect(u.query.has('b')).toBe(true)
    expect(u.query.toObject()).toEqual({ a: '2', b: 'x' })
    u.query.upsert({ key: 'b', value: 'y' })
    u.query.add({ key: 'c', value: '3' })
    u.query.remove('a')
    expect(u.toString()).toBe('https://a.test/p?b=y&c=3#h')
    expect(u.getPathWithQuery()).toBe('/p?b=y&c=3')
  })
})

describe('createPmRequestBody', () => {
  it('maps every Testnizer body type onto Postman modes', () => {
    expect(createPmRequestBody(undefined)).toBeUndefined()
    expect(createPmRequestBody({ type: 'none' })).toBeUndefined()
    expect(createPmRequestBody({ type: 'xml', content: '<a/>' })?.options?.raw.language).toBe('xml')
    const fd = createPmRequestBody({
      type: 'form-data',
      formData: [
        { key: 't', value: 'v', enabled: true },
        { key: 'f', value: '', enabled: true, type: 'file', filePath: '/tmp/x.bin' },
        { key: 'off', value: 'z', enabled: false },
      ],
    })
    expect(fd?.mode).toBe('formdata')
    expect(fd?.formdata?.toObject()).toEqual({ t: 'v', f: '' })
    expect(fd?.formdata?.one('f')).toMatchObject({ type: 'file', src: '/tmp/x.bin' })
    const bin = createPmRequestBody({ type: 'binary', binaryPath: '/tmp/b' })
    expect(bin?.mode).toBe('file')
    expect(bin?.file).toEqual({ src: '/tmp/b' })
  })
})

describe('createPm', () => {
  it('logs the visualizer notice once and never throws', () => {
    const { pm, logs } = makePm()
    pm.visualizer?.set('<b/>', {})
    pm.visualizer?.set('<i/>', {})
    pm.visualizer?.clear()
    expect(logs.filter((l) => l.message.startsWith('pm.visualizer'))).toHaveLength(1)
  })

  it('pm.execution.location defaults to [requestName] with .current', () => {
    const { pm } = makePm({ requestName: 'R', location: ['Folder A', 'Folder B', 'R'] })
    expect([...(pm.execution.location ?? [])]).toEqual(['Folder A', 'Folder B', 'R'])
    expect(pm.execution.location?.current).toBe('R')
    expect(makePm({ requestName: 'Only' }).pm.execution.location?.current).toBe('Only')
  })

  it('iterationData has toJSON() and unset()', () => {
    const { pm } = makePm()
    expect(pm.iterationData.toJSON?.()).toEqual({ row: 'R1' })
    pm.iterationData.unset?.('row')
    expect(pm.iterationData.get('row')).toBeUndefined()
    expect(pm.variables.get('row')).toBeUndefined()
  })

  it('stores strings: a Url-like value keeps its text, an object is JSON', () => {
    const { pm, envUpdates } = makePm()
    pm.environment.set('u', pm.request.url)
    pm.environment.set('o', { a: 1 })
    pm.environment.set('n', 5)
    expect(envUpdates.get('u')).toBe('https://h.test/p')
    expect(envUpdates.get('o')).toBe('{"a":1}')
    expect(pm.environment.get('n')).toBe('5')
  })

  it('skipRequest throws the stop signal in pre-request and records the skip', () => {
    const { runtime, pm } = makePm({ eventName: 'prerequest' })
    let caught: unknown
    try {
      pm.execution.skipRequest()
    } catch (e) {
      caught = e
    }
    expect(isSkipRequestSignal(caught)).toBe(true)
    expect(runtime.state.skipRequested).toBe(true)
  })

  it('setNextRequest records the target for the host', () => {
    const { runtime, pm } = makePm()
    pm.execution.setNextRequest(null)
    expect(runtime.state.nextRequest).toEqual({ name: null })
  })
})

describe('pm.sendRequest helpers (shared by Send and Run)', () => {
  it('normalizes a Url object passed as url', () => {
    expect(normalizePmSendInput({ url: new PmUrl('https://x.test/a?b=1') }).url).toBe(
      'https://x.test/a?b=1',
    )
  })

  it('wraps the response with the full pm.response surface; json() stays null-safe', () => {
    const r = buildPmSendResponse({
      status: 201,
      statusText: 'Created',
      body: 'not json',
      timing: { total: 7 },
    })
    expect(r.code).toBe(201)
    expect(r.responseTime).toBe(7)
    expect(r.json()).toBeNull()
    expect(() => r.to.have.status(201)).not.toThrow()
  })
})
