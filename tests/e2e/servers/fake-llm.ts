import http from 'node:http'

export interface FakeLlmServer {
  port: number
  url: string
  close: () => Promise<void>
}

/** OpenAI-compatible chat completions stub for AI Chat E2E. */
export async function startFakeLlmServer(port: number): Promise<FakeLlmServer> {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocol: 'fake-llm', port }))
      return
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages?: { content?: string }[]
        stream?: boolean
      }
      const last = body.messages?.at(-1)?.content ?? ''
      const reply = `E2E stub reply to: ${last.slice(0, 80)}`

      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'e2e-stub',
          choices: [{ message: { role: 'assistant', content: reply } }],
        }),
      )
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
    url: `http://127.0.0.1:${port}/v1/chat/completions`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
