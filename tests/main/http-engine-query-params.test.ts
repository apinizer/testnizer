/**
 * Issue #17 regression — the engine must never send a query key twice.
 *
 * axios appends `config.params` to whatever query the URL already carries, so a
 * request that holds the same param BOTH in the URL and in the params table
 * (every Insomnia import; any URL typed with a ?query while the Params tab
 * mirrors it) used to go out as `?type=x&type=x`. The engine now drops table
 * entries whose key the URL query already carries.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'

let server: http.Server
let base: string
let lastUrl = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastUrl = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, seen: req.url }))
  })
  await new Promise<void>((r) => server.listen(0, r))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterAll(() => server.close())

describe('http engine — query param de-duplication (issue #17)', () => {
  it('does NOT double a key present in both the URL and the params table', async () => {
    await executeHttpRequest({
      method: 'GET',
      url: `${base}/connections/?type=snmp`,
      params: [{ key: 'type', value: 'snmp', enabled: true }],
    } as never)
    expect(lastUrl).toBe('/connections/?type=snmp')
  })

  it('still appends params not present in the URL query', async () => {
    await executeHttpRequest({
      method: 'GET',
      url: `${base}/connections/?type=snmp`,
      params: [{ key: 'page', value: '2', enabled: true }],
    } as never)
    expect(lastUrl).toBe('/connections/?type=snmp&page=2')
  })

  it('clean URL + params table → single query', async () => {
    await executeHttpRequest({
      method: 'GET',
      url: `${base}/connections/`,
      params: [{ key: 'type', value: 'snmp', enabled: true }],
    } as never)
    expect(lastUrl).toBe('/connections/?type=snmp')
  })

  it('URL query only, no params table → untouched (repeated keys survive)', async () => {
    await executeHttpRequest({
      method: 'GET',
      url: `${base}/connections/?id=1&id=2`,
      params: [],
    } as never)
    expect(lastUrl).toBe('/connections/?id=1&id=2')
  })
})
