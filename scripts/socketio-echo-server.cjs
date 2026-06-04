#!/usr/bin/env node
/**
 * Local Socket.IO echo server for testing the Testnizer Socket.IO editor.
 *
 * Run with:  node scripts/socketio-echo-server.cjs
 *           or  npm run dev:socketio-echo
 *
 * Default port: 3001 (override with PORT env var)
 *
 * Behaviour:
 *   - Connect:  http://localhost:3001  (any namespace)
 *   - Emit any event with any payload → server echoes it back as `echo`
 *     with shape: { event, data, receivedAt }
 *   - Built-in events:
 *       'ping' → server replies with 'pong' { ts }
 *       'broadcast' → server fans the payload out to all connected clients
 *                     on event 'broadcast'
 *       'whoami' → server replies with 'whoami' { id, namespace, address }
 *   - Logs every connect/disconnect/event to stdout.
 */

/* eslint-disable no-console */
const http = require('http')
const { Server } = require('socket.io')

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', protocol: 'socket.io', port: PORT }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(
    [
      'Testnizer Socket.IO Echo Server',
      '─────────────────────────────────',
      `Connect via Socket.IO client to:  http://${HOST}:${PORT}`,
      'Try emitting:',
      '  • any event   →   server echoes it back on "echo"',
      '  • "ping"       →   "pong" { ts }',
      '  • "broadcast"  →   broadcast payload to every connected client',
      '  • "whoami"     →   "whoami" with your socket id',
      '',
      `GET /health → JSON status`,
    ].join('\n'),
  )
})

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

function setupSocket(socket) {
  const ns = socket.nsp.name
  const remote = socket.handshake.address
  console.log(`[+] connect   id=${socket.id}   ns=${ns}   from=${remote}`)

  socket.emit('welcome', {
    id: socket.id,
    namespace: ns,
    serverTime: new Date().toISOString(),
    message: 'Connected to Testnizer Socket.IO echo server',
  })

  socket.onAny((event, ...args) => {
    const data = args.length === 1 ? args[0] : args
    const preview = JSON.stringify(data)
    console.log(`    ←  ${event}: ${preview.length > 80 ? preview.slice(0, 77) + '…' : preview}`)

    if (event === 'ping') {
      socket.emit('pong', { ts: Date.now() })
      return
    }
    if (event === 'broadcast') {
      socket.nsp.emit('broadcast', { from: socket.id, data, ts: Date.now() })
      return
    }
    if (event === 'whoami') {
      socket.emit('whoami', { id: socket.id, namespace: ns, address: remote })
      return
    }

    // Default: echo
    socket.emit('echo', {
      event,
      data,
      receivedAt: new Date().toISOString(),
    })
  })

  socket.on('disconnect', (reason) => {
    console.log(`[-] disconnect id=${socket.id}   reason=${reason}`)
  })
}

// Default namespace ('/') and any custom namespace the client connects to.
io.on('connection', setupSocket)
io.of(/^\/.+$/).on('connection', setupSocket)

httpServer.listen(PORT, HOST, () => {
  console.log(`Testnizer Socket.IO echo server listening on http://${HOST}:${PORT}`)
  console.log(`Health check: curl http://${HOST}:${PORT}/health`)
  console.log('Press Ctrl+C to stop.')
})

function shutdown() {
  console.log('\nShutting down…')
  io.close(() => {
    httpServer.close(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 3000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
