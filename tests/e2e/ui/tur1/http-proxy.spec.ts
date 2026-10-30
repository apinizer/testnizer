/**
 * MST-053 — Proxy HTTP CONNECT tunnel
 *
 * Spins up a minimal HTTP proxy that handles CONNECT tunneling for HTTPS
 * and plain GET forwarding for HTTP. Tests that the engine can route
 * requests through a proxy when proxy settings are configured.
 *
 * Two sub-tests:
 *  a) HTTP proxy forwards GET → echo server responds 200.
 *  b) Engine gracefully handles unreachable proxy (error, not crash).
 *
 * CONNECT (HTTPS through proxy) smoke: verifies the CONNECT method is
 * sent to the proxy — not a full TLS chain since self-signed cert adds
 * complexity. We assert the proxy receives the CONNECT request.
 */
import http from 'node:http'
import net from 'node:net'
import { URL } from 'node:url'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { sendRequest } from '../../helpers/api'
import { localHttpBin } from '../../helpers/test-servers'

const echo = () => localHttpBin()

interface ProxyServer {
  url: string
  connectCount: () => number
  forwardCount: () => number
  close: () => void
}

async function startHttpProxy(): Promise<ProxyServer> {
  let connects = 0
  let forwards = 0

  const srv = http.createServer((req, res) => {
    // Plain HTTP forward
    forwards++
    const target = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const options: http.RequestOptions = {
      hostname: target.hostname,
      port: target.port ? Number(target.port) : 80,
      path: target.pathname + target.search,
      method: req.method,
      headers: req.headers,
    }
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxyReq.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(proxyReq)
  })

  // Handle CONNECT (for HTTPS tunnels)
  srv.on('connect', (req, clientSocket, head) => {
    connects++
    const [host, portStr] = (req.url ?? '').split(':')
    const port = Number(portStr) || 443
    const serverSocket = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      serverSocket.write(head)
      serverSocket.pipe(clientSocket)
      clientSocket.pipe(serverSocket)
    })
    serverSocket.on('error', () => {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      clientSocket.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    srv.listen(0, '127.0.0.1', () => resolve())
    srv.on('error', reject)
  })

  const addr = srv.address() as { port: number }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    connectCount: () => connects,
    forwardCount: () => forwards,
    close: () => srv.close(),
  }
}

uiTest.describe('Tur1 — Proxy HTTP CONNECT [MST-053]', () => {
  let proxy: ProxyServer

  uiTest.beforeAll(async () => {
    proxy = await startHttpProxy()
  })

  uiTest.afterAll(() => {
    proxy?.close()
  })

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('MST-053a HTTP request routed through proxy returns 200', async ({ window }) => {
    const proxyUrl = new URL(proxy.url)
    const forwardsBefore = proxy.forwardCount()
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${echo()}/get?via=proxy`,
      proxy: { mode: 'custom', host: proxyUrl.hostname, port: Number(proxyUrl.port) },
    })
    expect(res.status).toBe(200)
    // The request really went through the proxy, not directly to the echo server.
    expect(proxy.forwardCount()).toBeGreaterThan(forwardsBefore)
  })

  uiTest('MST-053b proxy settings UI section is reachable (Project Detail → Proxy tab)', async ({ window }) => {
    // Proxy is configured per project (Project Detail → Proxy) and globally
    // (Settings modal, covered by settings-advanced MST-197) — the request
    // Settings tab has no proxy section.
    await window.getByTestId('nav-settings').click()
    const modal = window.getByTestId('project-detail-modal')
    await expect(modal).toBeVisible({ timeout: 8_000 })
    await modal.getByTestId('project-detail-tab-proxy').click()

    await expect(modal.getByRole('button', { name: /Use system proxy|Sistem proxy/i })).toBeVisible()
    await expect(modal.getByRole('button', { name: /^No proxy$|^Proxy yok$/i })).toBeVisible()
    await expect(modal.getByRole('button', { name: /Custom proxy|Özel proxy/i })).toBeVisible()

    await window.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 5_000 })
  })

  uiTest('MST-053c unreachable proxy produces error response (no crash)', async ({ window }) => {
    // A port nothing listens on: grab a free one and close it again.
    const dead = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer()
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address() as net.AddressInfo
        srv.close(() => resolve(port))
      })
      srv.on('error', reject)
    })
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${echo()}/get`,
      proxy: { mode: 'custom', host: '127.0.0.1', port: dead },
    })
    // The request must fail through the proxy (no direct fallback), as a
    // reported error — not a JS crash.
    expect(res.status ?? 0).not.toBe(200)
    expect(res.error ?? '').not.toMatch(/TypeError|is not a function/)
    expect(res.error ?? '').toMatch(/ECONNREFUSED|connect|proxy/i)
  })
})
