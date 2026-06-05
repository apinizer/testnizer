import http from 'node:http'
import { Server } from 'socket.io'

export interface SocketIoServer {
  port: number
  url: string
  close: () => Promise<void>
}

export async function startSocketIoServer(port: number): Promise<SocketIoServer> {
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocol: 'socket.io', port }))
      return
    }
    res.writeHead(200)
    res.end('socket.io echo')
  })

  const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } })

  const onConnect = (socket: import('socket.io').Socket) => {
    socket.emit('welcome', { id: socket.id, ts: Date.now() })
    socket.onAny((event: string, ...args: unknown[]) => {
      const data = args.length === 1 ? args[0] : args
      if (event === 'ping') {
        socket.emit('pong', { ts: Date.now() })
        return
      }
      socket.emit('echo', { event, data, receivedAt: new Date().toISOString() })
    })
  }

  io.on('connection', onConnect)
  io.of(/^\/.+$/).on('connection', onConnect)

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, '127.0.0.1', () => resolve())
    httpServer.on('error', reject)
  })

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        io.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()))
        })
      }),
  }
}
