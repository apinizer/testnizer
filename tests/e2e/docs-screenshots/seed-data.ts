/**
 * Demo data for the documentation screenshots.
 *
 * Everything here is fictional: "Acme Orders" is a made-up shop API, every
 * address is example.com, every key is an obvious `sk-demo-…` placeholder.
 * The same Postman collection feeds both the APIs tree (requests, scripts,
 * assertions, saved examples) and the HTTP mock server the requests are sent
 * to, so every response panel in the screenshots is real app output.
 */

type Json = Record<string, unknown>

const ORDER_1042 = {
  id: 'ord_1042',
  status: 'open',
  customer: { id: 'cus_311', name: 'Jordan Rivera', email: 'jordan.rivera@example.com' },
  items: [
    { sku: 'MUG-BLUE-12', name: 'Enamel mug, blue', quantity: 2, unitPrice: 14.5 },
    { sku: 'TEE-ORG-M', name: 'Organic tee, size M', quantity: 1, unitPrice: 24.0 },
  ],
  total: 53.0,
  currency: 'USD',
  shipping: { method: 'standard', city: 'Springfield', country: 'US' },
  createdAt: '2026-11-02T09:41:12Z',
}

const ORDER_LIST = {
  items: [
    { id: 'ord_1042', status: 'open', customerId: 'cus_311', total: 53.0, currency: 'USD' },
    { id: 'ord_1041', status: 'shipped', customerId: 'cus_207', total: 129.9, currency: 'USD' },
    { id: 'ord_1040', status: 'open', customerId: 'cus_188', total: 18.25, currency: 'USD' },
    { id: 'ord_1039', status: 'delivered', customerId: 'cus_311', total: 74.0, currency: 'USD' },
  ],
  page: 1,
  limit: 20,
  total: 4,
}

const CUSTOMER = {
  id: 'cus_311',
  name: 'Jordan Rivera',
  email: 'jordan.rivera@example.com',
  tier: 'gold',
  orders: 12,
  since: '2024-03-18',
}

const PRODUCTS = {
  items: [
    { sku: 'MUG-BLUE-12', name: 'Enamel mug, blue', price: 14.5, stock: 140 },
    { sku: 'TEE-ORG-M', name: 'Organic tee, size M', price: 24.0, stock: 62 },
    { sku: 'CAP-GRY', name: 'Canvas cap, grey', price: 19.0, stock: 0 },
  ],
  total: 3,
}

function jsonHeaders(): Json[] {
  return [{ key: 'Content-Type', value: 'application/json' }]
}

function example(
  name: string,
  method: string,
  raw: string,
  code: number,
  status: string,
  body: unknown,
): Json {
  return {
    name,
    originalRequest: { method, header: [], url: { raw } },
    status,
    code,
    _postman_previewlanguage: 'json',
    header: jsonHeaders(),
    body: JSON.stringify(body, null, 2),
  }
}

function url(raw: string): Json {
  const [pathPart, query] = raw.split('?')
  const out: Json = {
    raw,
    host: ['{{baseUrl}}'],
    path: pathPart.replace('{{baseUrl}}/', '').split('/'),
  }
  if (query) {
    out.query = query.split('&').map((kv) => {
      const [key, value] = kv.split('=')
      return { key, value }
    })
  }
  return out
}

function testEvent(lines: string[]): Json {
  return { listen: 'test', script: { type: 'text/javascript', exec: lines } }
}
function preEvent(lines: string[]): Json {
  return { listen: 'prerequest', script: { type: 'text/javascript', exec: lines } }
}

const LIST_ORDERS_TESTS = [
  "pm.test('Status is 200', () => {",
  '  pm.response.to.have.status(200)',
  '})',
  '',
  "pm.test('Responds in under 500 ms', () => {",
  '  pm.expect(pm.response.responseTime).to.be.below(500)',
  '})',
  '',
  "pm.test('Every order has an id and a total', () => {",
  '  const { items } = pm.response.json()',
  "  pm.expect(items).to.be.an('array').that.is.not.empty",
  "  items.forEach((o) => pm.expect(o).to.include.keys('id', 'total'))",
  '})',
  '',
  "pm.environment.set('lastOrderId', pm.response.json().items[0].id)",
]

const CREATE_ORDER_PRE = [
  '// Stamp every new order with a unique idempotency key',
  "pm.variables.set('idempotencyKey', pm.variables.replaceIn('{{$guid}}'))",
  "pm.request.headers.add({ key: 'Idempotency-Key', value: pm.variables.get('idempotencyKey') })",
  '',
  "console.log('Creating order for', pm.environment.get('customerId'))",
]

const CREATE_ORDER_TESTS = [
  "pm.test('Order was created', () => {",
  '  pm.response.to.have.status(201)',
  '})',
  '',
  "pm.test('Order is open and priced', () => {",
  '  const order = pm.response.json()',
  "  pm.expect(order.status).to.eql('open')",
  '  pm.expect(order.total).to.be.above(0)',
  '})',
  '',
  "pm.environment.set('orderId', pm.response.json().id)",
]

const CREATE_ORDER_BODY = {
  customerId: '{{customerId}}',
  items: [
    { sku: 'MUG-BLUE-12', quantity: 2 },
    { sku: 'TEE-ORG-M', quantity: 1 },
  ],
  shipping: { method: 'standard', city: 'Springfield', country: 'US' },
  note: 'Gift wrap, please',
}

function request(
  name: string,
  method: string,
  raw: string,
  opts: {
    body?: unknown
    headers?: Json[]
    events?: Json[]
    responses?: Json[]
    description?: string
  } = {},
): Json {
  const req: Json = {
    method,
    header: opts.headers ?? [{ key: 'Accept', value: 'application/json' }],
    url: url(raw),
  }
  if (opts.body !== undefined) {
    req.body = {
      mode: 'raw',
      raw: JSON.stringify(opts.body, null, 2),
      options: { raw: { language: 'json' } },
    }
  }
  if (opts.description) req.description = opts.description
  return {
    name,
    request: req,
    event: opts.events ?? [],
    response: opts.responses ?? [],
  }
}

export function acmeCollection(): Json {
  const listRaw = '{{baseUrl}}/orders?status=open&limit=20'
  return {
    info: {
      _postman_id: '6f1d2c1e-0000-4000-8000-00000000demo',
      name: 'Acme Orders API',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Orders',
        item: [
          request('List orders', 'GET', listRaw, {
            events: [testEvent(LIST_ORDERS_TESTS)],
            responses: [example('Open orders', 'GET', listRaw, 200, 'OK', ORDER_LIST)],
          }),
          request('Get order', 'GET', '{{baseUrl}}/orders/ord_1042', {
            responses: [
              example(
                'Order ord_1042',
                'GET',
                '{{baseUrl}}/orders/ord_1042',
                200,
                'OK',
                ORDER_1042,
              ),
            ],
          }),
          request('Create order', 'POST', '{{baseUrl}}/orders', {
            headers: [
              { key: 'Content-Type', value: 'application/json' },
              { key: 'Accept', value: 'application/json' },
              { key: 'X-Request-Source', value: 'testnizer-docs' },
            ],
            body: CREATE_ORDER_BODY,
            events: [preEvent(CREATE_ORDER_PRE), testEvent(CREATE_ORDER_TESTS)],
            responses: [
              example('Created', 'POST', '{{baseUrl}}/orders', 201, 'Created', {
                ...ORDER_1042,
                id: 'ord_1043',
                note: 'Gift wrap, please',
              }),
            ],
          }),
          request('Update order', 'PUT', '{{baseUrl}}/orders/ord_1042', {
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            body: { shipping: { method: 'express' } },
            responses: [
              example('Updated', 'PUT', '{{baseUrl}}/orders/ord_1042', 200, 'OK', {
                ...ORDER_1042,
                shipping: { ...ORDER_1042.shipping, method: 'express' },
              }),
            ],
          }),
          request('Cancel order', 'DELETE', '{{baseUrl}}/orders/ord_1040', {
            responses: [
              example('Cancelled', 'DELETE', '{{baseUrl}}/orders/ord_1040', 200, 'OK', {
                id: 'ord_1040',
                status: 'cancelled',
              }),
            ],
          }),
        ],
      },
      {
        name: 'Customers',
        item: [
          request('List customers', 'GET', '{{baseUrl}}/customers?tier=gold', {
            responses: [
              example('Gold customers', 'GET', '{{baseUrl}}/customers?tier=gold', 200, 'OK', {
                items: [
                  CUSTOMER,
                  {
                    ...CUSTOMER,
                    id: 'cus_207',
                    name: 'Sam Okafor',
                    email: 'sam.okafor@example.com',
                    orders: 7,
                  },
                ],
                total: 2,
              }),
            ],
          }),
          request('Get customer', 'GET', '{{baseUrl}}/customers/cus_311', {
            responses: [
              example('Customer', 'GET', '{{baseUrl}}/customers/cus_311', 200, 'OK', CUSTOMER),
            ],
          }),
          request('Create customer', 'POST', '{{baseUrl}}/customers', {
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            body: { name: 'Alex Morgan', email: 'alex.morgan@example.com', tier: 'silver' },
            responses: [
              example('Created', 'POST', '{{baseUrl}}/customers', 201, 'Created', {
                id: 'cus_412',
                name: 'Alex Morgan',
                email: 'alex.morgan@example.com',
                tier: 'silver',
                orders: 0,
              }),
            ],
          }),
        ],
      },
      {
        name: 'Catalog',
        item: [
          request('List products', 'GET', '{{baseUrl}}/products', {
            events: [
              testEvent([
                "pm.test('Status is 200', () => pm.response.to.have.status(200))",
                "pm.test('Has products', () => pm.expect(pm.response.json().total).to.be.above(0))",
              ]),
            ],
            responses: [example('Products', 'GET', '{{baseUrl}}/products', 200, 'OK', PRODUCTS)],
          }),
          request('Get product', 'GET', '{{baseUrl}}/products/MUG-BLUE-12', {
            responses: [
              example(
                'Product',
                'GET',
                '{{baseUrl}}/products/MUG-BLUE-12',
                200,
                'OK',
                PRODUCTS.items[0],
              ),
            ],
          }),
          request('Update stock', 'PATCH', '{{baseUrl}}/products/CAP-GRY/stock', {
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            body: { stock: 25 },
            responses: [
              example('Restocked', 'PATCH', '{{baseUrl}}/products/CAP-GRY/stock', 200, 'OK', {
                sku: 'CAP-GRY',
                stock: 25,
              }),
            ],
          }),
        ],
      },
      request('Health check', 'GET', '{{baseUrl}}/health', {
        events: [testEvent(["pm.test('Service is up', () => pm.response.to.have.status(200))"])],
        responses: [
          example('Healthy', 'GET', '{{baseUrl}}/health', 200, 'OK', {
            status: 'ok',
            version: '2.4.1',
            uptimeSeconds: 86400,
          }),
        ],
      }),
    ],
    auth: {
      type: 'apikey',
      apikey: [
        { key: 'key', value: 'X-API-Key', type: 'string' },
        { key: 'value', value: '{{apiKey}}', type: 'string' },
        { key: 'in', value: 'header', type: 'string' },
      ],
    },
  }
}

/** Environment variables. `apiKey` is marked secret so the editor masks it. */
export function stagingVariables(baseUrl: string): Array<{
  key: string
  value: string
  secret?: boolean
}> {
  return [
    { key: 'baseUrl', value: baseUrl },
    { key: 'apiKey', value: 'sk-demo-4f9a1c7e2b8d', secret: true },
    { key: 'customerId', value: 'cus_311' },
    { key: 'currency', value: 'USD' },
    { key: 'orderId', value: 'ord_1042' },
  ]
}

/** Mock MCP server definition: an "Acme Orders" tool server (fictional). */
export function acmeMcpServer(projectId: string, port: number): Json {
  return {
    projectId,
    name: 'Acme Orders MCP',
    description: 'Order lookup tools for the Acme support assistant.',
    port,
    path: '/mcp',
    legacyMode: 'stateless',
    cacheTtlMs: 0,
    tools: [
      {
        name: 'search_orders',
        title: 'Search orders',
        description: 'Find orders by status and customer. Returns at most `limit` orders.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['open', 'paid', 'shipped', 'delivered', 'cancelled'] },
            customerId: { type: 'string', description: 'Customer id, e.g. cus_311' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
          required: ['status'],
        },
        response: {
          kind: 'json',
          body: JSON.stringify(
            {
              total: 2,
              orders: [
                { id: 'ord_1042', status: 'open', total: 53.0, currency: 'USD' },
                { id: 'ord_1040', status: 'open', total: 18.25, currency: 'USD' },
              ],
            },
            null,
            2,
          ),
        },
      },
      {
        name: 'get_order',
        title: 'Get order',
        description: 'Fetch one order with its line items.',
        inputSchema: {
          type: 'object',
          properties: { orderId: { type: 'string', description: 'Order id, e.g. ord_1042' } },
          required: ['orderId'],
        },
        response: {
          kind: 'template',
          body: '{"id":"{{args.orderId}}","status":"open","total":53.0,"items":2}',
        },
      },
      {
        name: 'refund_order',
        title: 'Refund order',
        description: 'Refund an order in full or in part.',
        inputSchema: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            amount: { type: 'number', minimum: 0 },
            reason: { type: 'string', enum: ['damaged', 'late', 'other'] },
          },
          required: ['orderId', 'amount'],
        },
        response: {
          kind: 'template',
          body: 'Refund of {{args.amount}} queued for {{args.orderId}}.',
        },
      },
      {
        name: 'echo',
        title: 'Echo',
        description: 'Echoes the given text back.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Text to echo' } },
          required: ['text'],
        },
        response: { kind: 'template', body: '{{args.text}}' },
      },
    ],
    resources: [
      {
        uri: 'acme://orders/ord_1042',
        name: 'Order ord_1042',
        mimeType: 'application/json',
        text: JSON.stringify({ id: 'ord_1042', status: 'open', total: 53.0 }, null, 2),
      },
      {
        uri: 'acme://policies/refunds',
        name: 'Refund policy',
        mimeType: 'text/markdown',
        text: '# Refunds\nOrders can be refunded within 30 days of delivery.',
      },
    ],
    prompts: [
      {
        name: 'summarize_order',
        title: 'Summarize order',
        description: 'Write a one-paragraph summary of an order for a support agent.',
        arguments: [{ name: 'orderId', required: true }],
        messages: [{ role: 'user', text: 'Summarize order {{args.orderId}} for a support agent.' }],
      },
    ],
  }
}
