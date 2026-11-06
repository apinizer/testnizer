/**
 * A real HTTP CONNECT proxy for tests: it tunnels to the host and port asked for and
 * remembers what it saw, so a test proves the traffic went through it. `answer` makes
 * it misbehave: `407` refuses the credentials, `502` refuses the tunnel, `hang` takes
 * the CONNECT and never answers (the case a client's Stop has to end by itself).
 */
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import type { ProxySetting } from '../../src/shared/request-settings'

export type ProxyAnswer = 'tunnel' | '407' | '502' | 'hang'

export interface SeenConnect {
  target: string
  authorization?: string
}

export interface ConnectProxy {
  port: number
  origin: string
  connects: SeenConnect[]
  /** Other requests: a client that sent plain HTTP instead of a CONNECT. */
  plainRequests: string[]
  answer: ProxyAnswer
  /** Sockets from clients still open. */
  openSockets: () => number
  /** The setting a project would hold for this proxy. */
  setting: (auth?: { username: string; password: string }) => ProxySetting
  /** Cut every open tunnel, as a dropped network would. */
  dropTunnels: () => void
  close: () => Promise<void>
}

export async function startConnectProxy(answer: ProxyAnswer = 'tunnel'): Promise<ConnectProxy> {
  const clientSockets = new Set<net.Socket>()
  const upstream = new Set<net.Socket>()

  const server = http.createServer((req, res) => {
    proxy.plainRequests.push(`${req.method} ${req.url}`)
    res.writeHead(400)
    res.end()
  })
  server.on('connection', (socket) => {
    clientSockets.add(socket)
    socket.on('close', () => clientSockets.delete(socket))
  })
  server.on('connect', (req, client: net.Socket, head) => {
    client.on('error', () => {})
    proxy.connects.push({
      target: req.url ?? '',
      ...(typeof req.headers['proxy-authorization'] === 'string'
        ? { authorization: req.headers['proxy-authorization'] }
        : {}),
    })
    if (proxy.answer === 'hang') {
      // Reading is how a socket here sees the client go away, and an HTTP server's
      // socket is half-open: it stays until this side ends it too.
      client.on('end', () => client.destroy())
      client.resume()
      return
    }
    if (proxy.answer === '407') {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\n' +
          'Proxy-Authenticate: Basic realm="test"\r\n' +
          'Content-Length: 0\r\n\r\n',
      )
      return
    }
    if (proxy.answer === '502') {
      client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const idx = (req.url ?? '').lastIndexOf(':')
    const host = (req.url ?? '').slice(0, idx).replace(/^\[|\]$/g, '')
    const port = Number((req.url ?? '').slice(idx + 1))
    const remote = net.connect(port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) remote.write(head)
      remote.pipe(client)
      client.pipe(remote)
    })
    upstream.add(remote)
    remote.on('error', () => client.destroy())
    remote.on('close', () => {
      upstream.delete(remote)
      client.destroy()
    })
    client.on('close', () => remote.destroy())
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const proxy: ConnectProxy = {
    port,
    origin: `http://127.0.0.1:${port}`,
    connects: [],
    plainRequests: [],
    answer,
    openSockets: () => clientSockets.size,
    setting: (auth) => ({
      mode: 'custom',
      host: '127.0.0.1',
      port,
      ...(auth ? { auth } : {}),
    }),
    dropTunnels: () => {
      for (const s of clientSockets) s.destroy()
    },
    close: async () => {
      for (const s of clientSockets) s.destroy()
      for (const s of upstream) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  return proxy
}

/** A port nothing listens on. */
export async function closedPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}
