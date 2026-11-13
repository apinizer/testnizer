/**
 * Small fictional servers for the documentation screenshots: an "Acme Orders"
 * WebSocket feed, a GraphQL endpoint and an MQTT broker. Fixed ports, so the
 * addresses in the screenshots are stable from run to run; a taken port fails
 * the run instead of silently moving.
 */
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { graphql, buildSchema } from 'graphql'
import { startAedesBroker } from '../../helpers/mqtt-aedes-broker'

export const DEMO_PORTS = {
  httpMock: 4010,
  mcpMock: 4011,
  sseMock: 4012,
  aiMock: 4013,
  ws: 4020,
  graphql: 4021,
  mqtt: 4022,
} as const

export interface DemoServers {
  wsUrl: string
  graphqlUrl: string
  mqttUrl: string
  close: () => Promise<void>
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', (e) =>
      reject(new Error(`docs-screenshots: port ${port} is taken (${(e as Error).message})`)),
    )
    server.listen(port, '127.0.0.1', () => resolve())
  })
}

const schema = buildSchema(`
  type LineItem { sku: String!, name: String!, quantity: Int!, unitPrice: Float! }
  type Customer { id: ID!, name: String!, email: String!, tier: String! }
  type Order { id: ID!, status: String!, total: Float!, currency: String!, customer: Customer!, items: [LineItem!]! }
  type Query {
    order(id: ID!): Order
    orders(status: String, limit: Int): [Order!]!
  }
`)

const customer = {
  id: 'cus_311',
  name: 'Jordan Rivera',
  email: 'jordan.rivera@example.com',
  tier: 'gold',
}
const orders = [
  {
    id: 'ord_1042',
    status: 'open',
    total: 53.0,
    currency: 'USD',
    customer,
    items: [
      { sku: 'MUG-BLUE-12', name: 'Enamel mug, blue', quantity: 2, unitPrice: 14.5 },
      { sku: 'TEE-ORG-M', name: 'Organic tee, size M', quantity: 1, unitPrice: 24.0 },
    ],
  },
  {
    id: 'ord_1040',
    status: 'open',
    total: 18.25,
    currency: 'USD',
    customer: {
      ...customer,
      id: 'cus_188',
      name: 'Priya Natarajan',
      email: 'priya.n@example.com',
      tier: 'silver',
    },
    items: [{ sku: 'CAP-GRY', name: 'Canvas cap, grey', quantity: 1, unitPrice: 18.25 }],
  },
]
const root = {
  order: ({ id }: { id: string }) => orders.find((o) => o.id === id) ?? null,
  orders: ({ status, limit }: { status?: string; limit?: number }) =>
    orders.filter((o) => !status || o.status === status).slice(0, limit ?? 20),
}

export async function startDemoServers(): Promise<DemoServers> {
  // GraphQL
  const gql = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/graphql') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        query?: string
        variables?: Record<string, unknown>
        operationName?: string
      }
      const result = await graphql({
        schema,
        source: body.query ?? '',
        variableValues: body.variables,
        operationName: body.operationName,
        rootValue: root,
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result, null, 2))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await listen(gql, DEMO_PORTS.graphql)

  // WebSocket: a live order-status feed plus an echo of what the client sends.
  const wsHttp = http.createServer((_req, res) => {
    res.writeHead(200)
    res.end('acme orders feed')
  })
  const wss = new WebSocketServer({ server: wsHttp })
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'welcome', feed: 'orders', version: '2.4.1' }))
    ws.on('message', (data) => {
      const text = data.toString('utf8')
      let parsed: { action?: string; channel?: string } = {}
      try {
        parsed = JSON.parse(text)
      } catch {
        /* plain text */
      }
      if (parsed.action === 'subscribe') {
        ws.send(JSON.stringify({ type: 'subscribed', channel: parsed.channel ?? 'orders' }))
        const events = [
          { type: 'order.updated', id: 'ord_1042', status: 'paid', total: 53.0 },
          { type: 'order.updated', id: 'ord_1042', status: 'packed' },
          { type: 'order.created', id: 'ord_1043', total: 42.5, currency: 'USD' },
          { type: 'order.updated', id: 'ord_1041', status: 'delivered' },
        ]
        events.forEach((e, i) => setTimeout(() => ws.send(JSON.stringify(e)), 150 * (i + 1)))
        return
      }
      ws.send(JSON.stringify({ type: 'echo', data: parsed.action ? parsed : text }))
    })
  })
  await listen(wsHttp, DEMO_PORTS.ws)

  const broker = await startAedesBroker({ port: DEMO_PORTS.mqtt })

  return {
    wsUrl: `ws://127.0.0.1:${DEMO_PORTS.ws}/orders`,
    graphqlUrl: `http://127.0.0.1:${DEMO_PORTS.graphql}/graphql`,
    mqttUrl: `mqtt://127.0.0.1:${DEMO_PORTS.mqtt}`,
    close: async () => {
      await new Promise<void>((r) => wss.close(() => r()))
      await new Promise<void>((r) => wsHttp.close(() => r()))
      await new Promise<void>((r) => gql.close(() => r()))
      await broker.close()
    },
  }
}
