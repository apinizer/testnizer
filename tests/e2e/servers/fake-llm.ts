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
        messages?: { role?: string; content?: string | null }[]
        stream?: boolean
        tools?: Array<{ function?: { name?: string } }>
      }

      // Tool calling (issue #180): when the request offers an MCP `echo` tool
      // and no tool result came back yet, ask for it (streamed tool_calls
      // fragments, arguments split across chunks); once the tool result is in
      // the transcript, answer with it.
      const echoTool = body.tools
        ?.map((t) => t.function?.name ?? '')
        .find((n) => n.endsWith('__echo'))
      const toolMsg = body.messages?.find((m) => m.role === 'tool')
      if (body.stream && echoTool && !toolMsg) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const frag = (f: Record<string, unknown>): string =>
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...f }] } }] })}\n\n`
        res.write(
          frag({ id: 'call_e2e_1', type: 'function', function: { name: echoTool, arguments: '' } }),
        )
        res.write(frag({ function: { arguments: '{"text":' } }))
        res.write(frag({ function: { arguments: '"from-llm"}' } }))
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
        )
        res.write(
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\n`,
        )
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      if (body.stream && toolMsg) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const reply = `Final answer after tool: ${String(toolMsg.content ?? '')}`
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }

      const last = body.messages?.at(-1)?.content ?? ''
      // Echo selected request headers so specs can prove what reached the wire
      // (issue #120 custom headers, #121 optional key): the AI Chat editor has
      // no network panel of its own.
      const echo = req.headers['x-e2e-echo']
      const auth = req.headers['authorization']
      const suffix = `${echo ? ` [echo=${String(echo)}]` : ''}${auth ? ` [auth=${String(auth)}]` : ' [auth=none]'}`
      const reply = `E2E stub reply to: ${String(last).slice(0, 80)}${suffix}`

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
