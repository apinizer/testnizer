import http from 'node:http'

export interface SseServer {
  port: number
  url: string
  close: () => Promise<void>
}

export async function startSseServer(port: number): Promise<SseServer> {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocol: 'sse', port }))
      return
    }

    if (req.url === '/events' || req.url?.startsWith('/events?')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      let n = 0
      const send = () => {
        n += 1
        res.write(`id: ${n}\n`)
        res.write(`event: tick\n`)
        res.write(`data: ${JSON.stringify({ n, ts: Date.now() })}\n\n`)
        if (n >= 3) {
          clearInterval(timer)
          res.end()
        }
      }
      send()
      const timer = setInterval(send, 200)
      req.on('close', () => clearInterval(timer))
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  return {
    port,
    url: `http://127.0.0.1:${port}/events`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
