/**
 * "Bypass for hosts" was saved and shown but read by nothing: Send and Run sent a
 * listed host through the proxy. Real target server, real forward proxy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'

let target: Server
let proxy: Server
let targetPort = 0
let proxyPort = 0
const proxied: string[] = []
const direct: string[] = []

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

beforeAll(async () => {
  target = createServer((req, res) => {
    direct.push(req.url ?? '')
    res.end('from target')
  })
  proxy = createServer((req, res) => {
    proxied.push(req.url ?? '')
    res.end('from proxy')
  })
  targetPort = await listen(target)
  proxyPort = await listen(proxy)
})

afterAll(() => {
  target.close()
  proxy.close()
})

async function send(bypass?: string): Promise<{ status?: number; error?: string }> {
  proxied.length = 0
  direct.length = 0
  return (await executeHttpRequest({
    method: 'GET',
    url: `http://127.0.0.1:${targetPort}/x`,
    headers: [],
    proxy: { mode: 'custom', host: '127.0.0.1', port: proxyPort, ...(bypass ? { bypass } : {}) },
  } as never)) as { status?: number; error?: string }
}

describe('a saved SOCKS proxy', () => {
  it('refuses the request: neither the proxy nor the server sees it', async () => {
    proxied.length = 0
    direct.length = 0
    const res = (await executeHttpRequest({
      method: 'GET',
      url: `http://127.0.0.1:${targetPort}/x`,
      headers: [],
      proxy: { mode: 'custom', host: '127.0.0.1', port: proxyPort, proxyType: 'socks' },
    } as never)) as { error?: string }
    expect(res.error).toMatch(/SOCKS proxies are not supported/)
    expect(proxied).toEqual([])
    expect(direct).toEqual([])
  })
})

describe('HTTP and the proxy bypass list', () => {
  it('a listed host goes straight to the server', async () => {
    const res = await send('localhost, 127.0.0.1')
    expect(res.error).toBeFalsy()
    expect(res.status).toBe(200)
    expect(direct).toEqual(['/x'])
    expect(proxied).toEqual([])
  })

  it('a host not on the list goes through the proxy', async () => {
    const res = await send('*.internal')
    expect(res.error).toBeFalsy()
    expect(res.status).toBe(200)
    expect(proxied.length).toBe(1)
    expect(direct).toEqual([])
  })

  it('no list: through the proxy, as before', async () => {
    await send()
    expect(proxied.length).toBe(1)
    expect(direct).toEqual([])
  })
})
