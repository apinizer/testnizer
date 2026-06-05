import http from 'node:http'
import { WebSocketServer } from 'ws'

export interface WsEchoServer {
  port: number
  url: string
  close: () => Promise<void>
}

export async function startWsEchoServer(port: number): Promise<WsEchoServer> {
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocol: 'ws-echo', port }))
      return
    }
    res.writeHead(200)
    res.end('ws echo')
  })

  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'welcome', ts: Date.now() }))
    ws.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8')
      ws.send(JSON.stringify({ type: 'echo', data: text, receivedAt: new Date().toISOString() }))
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', () => resolve())
    httpServer.on('error', reject)
  })

  return {
    port,
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()))
        })
      }),
  }
}
