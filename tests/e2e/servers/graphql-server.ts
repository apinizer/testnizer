import http from 'node:http'
import { graphql, buildSchema } from 'graphql'

const schema = buildSchema(`
  type Query {
    hello(name: String): String
    echo(input: String): String
  }
  type Subscription {
    tick: Int
  }
`)

const root = {
  hello: ({ name }: { name?: string }) => `Hello ${name ?? 'world'}`,
  echo: ({ input }: { input?: string }) => input ?? '',
}

export interface GraphqlServer {
  port: number
  url: string
  close: () => Promise<void>
}

export async function startGraphqlServer(port: number): Promise<GraphqlServer> {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocol: 'graphql', port }))
      return
    }

    if (req.method === 'POST' && req.url === '/graphql') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        query?: string
        variables?: Record<string, unknown>
      }
      const result = await graphql({
        schema,
        source: body.query ?? '',
        variableValues: body.variables,
        rootValue: root,
      })
      const payload = JSON.stringify(result)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(payload)
      return
    }

    if (req.method === 'GET' && req.url?.startsWith('/graphql')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { __schema: { queryType: { name: 'Query' } } } }))
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
    url: `http://127.0.0.1:${port}/graphql`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
