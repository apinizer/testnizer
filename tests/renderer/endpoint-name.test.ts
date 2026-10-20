/**
 * Issue #201 — requests created from the APIs tree stayed "New Endpoint"
 * forever. `deriveEndpointName` turns the URL into a name; the save path uses
 * it only while the request still carries a placeholder name.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REQUEST_BY_PROTOCOL,
  autoRequestName,
  deriveEndpointName,
  isDefaultRequestName,
} from '../../src/renderer/lib/endpoint-name'

describe('deriveEndpointName', () => {
  it.each([
    ['{{baseUrl}}/v1/users', 'users'],
    ['https://api.test/v1/users/', 'users'],
    ['https://api.test/v1/users///', 'users'],
    ['https://api.test/v1/orders?status=open&page=2', 'orders'],
    ['https://api.test/v1/orders#section', 'orders'],
    ['https://api.test/v1/orders?x=1#frag', 'orders'],
    ['{{baseUrl}}/api/customers?x=1', 'customers'],
  ])('%s → %s (last path segment, query and fragment ignored)', (url, name) => {
    expect(deriveEndpointName(url)).toBe(name)
  })

  it.each([
    ['https://api.test/users/:id', 'users'],
    ['https://api.test/users/{{id}}', 'users'],
    ['https://api.test/users/{id}', 'users'],
    ['{{baseUrl}}/users/{{userId}}/orders/:orderId', 'orders'],
    ['{{baseUrl}}/users/{userId}/{{x}}/:y', 'users'],
  ])('%s → %s (variable / parameter segments skipped)', (url, name) => {
    expect(deriveEndpointName(url)).toBe(name)
  })

  it.each([
    ['https://api.test/users/123', 'users'],
    ['{{baseUrl}}/users/42/orders/7', 'orders'],
    ['https://api.test/users/3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'users'],
    ['https://api.test/users/3F2504E0-4F89-11D3-9A0C-0305E82C3301/', 'users'],
    ['https://api.test/users/123?expand=1#top', 'users'],
    ['https://api.test/users/%31%32', 'users'], // decoded '12' is still an id
  ])('%s → %s (numeric and UUID id segments skipped)', (url, name) => {
    expect(deriveEndpointName(url)).toBe(name)
  })

  it.each([
    ['https://api.test/api/v2', 'v2'],
    ['https://api.test/files/report-1', 'report-1'],
    ['https://api.test/items/123abc', '123abc'],
    ['https://api.test/items/3f2504e0-4f89', '3f2504e0-4f89'], // not a full UUID
  ])('%s → %s (mixed segments are names, not ids)', (url, name) => {
    expect(deriveEndpointName(url)).toBe(name)
  })

  it('falls back to the host when every segment is an id', () => {
    expect(deriveEndpointName('https://api.test/123/456')).toBe('api.test')
    expect(deriveEndpointName('https://api.test/3f2504e0-4f89-11d3-9a0c-0305e82c3301/9')).toBe(
      'api.test',
    )
    expect(deriveEndpointName('{{baseUrl}}/123')).toBeNull()
  })

  it('keeps a segment that mixes text and a variable', () => {
    expect(deriveEndpointName('{{baseUrl}}/files/report-{{id}}')).toBe('report-{{id}}')
  })

  it('falls back to the host when there is no usable path segment', () => {
    expect(deriveEndpointName('https://api.example.com')).toBe('api.example.com')
    expect(deriveEndpointName('https://api.example.com/')).toBe('api.example.com')
    expect(deriveEndpointName('https://api.example.com:8443/{{id}}')).toBe('api.example.com')
    expect(deriveEndpointName('https://api.example.com/?q=1')).toBe('api.example.com')
  })

  it('handles URLs without a scheme', () => {
    expect(deriveEndpointName('api.test/v2/products')).toBe('products')
    expect(deriveEndpointName('localhost:3000/health')).toBe('health')
    expect(deriveEndpointName('localhost:3000')).toBe('localhost')
    expect(deriveEndpointName('/api/users')).toBe('users')
  })

  it('returns null when the host is only a variable and no segment is usable', () => {
    expect(deriveEndpointName('{{host}}')).toBeNull()
    expect(deriveEndpointName('{{baseUrl}}/')).toBeNull()
    expect(deriveEndpointName('{{baseUrl}}/:id')).toBeNull()
    expect(deriveEndpointName('https://{{host}}')).toBeNull()
    expect(deriveEndpointName('https://{{host}}:8080/{{id}}')).toBeNull()
    expect(deriveEndpointName('/{{id}}')).toBeNull()
    expect(deriveEndpointName('{{baseUrl}}{{path}}')).toBeNull()
    expect(deriveEndpointName('{{baseUrl}}/users/{{a}}{{b}}')).toBe('users')
  })

  it('returns null for an empty URL', () => {
    expect(deriveEndpointName('')).toBeNull()
    expect(deriveEndpointName('   ')).toBeNull()
  })

  it('URL-decodes the segment', () => {
    expect(deriveEndpointName('https://api.test/m%C3%BC%C5%9Fteriler')).toBe('müşteriler')
    expect(deriveEndpointName('https://api.test/order%20items?x=1')).toBe('order items')
  })

  it('keeps a malformed percent sequence raw instead of throwing', () => {
    expect(deriveEndpointName('https://api.test/bad%E0%A4')).toBe('bad%E0%A4')
  })

  it('works for other schemes (ws, ftp)', () => {
    expect(deriveEndpointName('ws://echo.example.com/chat')).toBe('chat')
    expect(deriveEndpointName('wss://echo.example.com')).toBe('echo.example.com')
    expect(deriveEndpointName('ftp://files.example.com/pub/readme.txt')).toBe('readme.txt')
  })

  it('never turns credentials in the URL into a name', () => {
    const name = deriveEndpointName('https://admin:s3cr3t@api.example.com')
    expect(name).toBe('api.example.com')
    expect(deriveEndpointName('https://admin:s3cr3t@api.example.com/')).toBe('api.example.com')
    expect(deriveEndpointName('https://token@{{host}}')).toBeNull()
  })

  it('never returns the scratch-tab name "New Request" (issue #69)', () => {
    expect(deriveEndpointName('{{baseUrl}}/New%20Request')).toBeNull()
    expect(deriveEndpointName('https://api.test/items/New%20Request')).toBe('items')
  })
})

describe('isDefaultRequestName', () => {
  it('recognises every Add Request default from the APIs tree', () => {
    for (const d of Object.values(DEFAULT_REQUEST_BY_PROTOCOL)) {
      expect(isDefaultRequestName(d!.name)).toBe(true)
    }
  })

  it.each([
    'New Endpoint',
    'New Request',
    'Untitled',
    'Quick Request',
    'Yeni Endpoint', // endpointSave.defaultName (TR)
    'Yeni Uç Nokta', // welcome.newEndpointName (TR)
    'Yeni İstek',
    'Hızlı İstek',
    '  New Endpoint  ',
    '',
  ])('%j is a placeholder', (name) => {
    expect(isDefaultRequestName(name)).toBe(true)
  })

  it.each(['My call', 'customers', 'new endpoint for billing', 'Get users'])(
    '%j is a user name',
    (name) => {
      expect(isDefaultRequestName(name)).toBe(false)
    },
  )
})

describe('autoRequestName', () => {
  it('renames an HTTP placeholder from its URL', () => {
    expect(autoRequestName('http', 'New Endpoint', '{{baseUrl}}/api/customers?x=1')).toBe(
      'customers',
    )
    expect(autoRequestName(undefined, 'Yeni Uç Nokta', 'https://api.test/orders')).toBe('orders')
  })

  it('keeps a name the user chose', () => {
    expect(autoRequestName('http', 'My call', 'https://api.test/orders')).toBeNull()
  })

  it('keeps the name when the URL yields nothing', () => {
    expect(autoRequestName('http', 'New Endpoint', '')).toBeNull()
    expect(autoRequestName('http', 'New Endpoint', '{{baseUrl}}')).toBeNull()
  })

  it('leaves other protocols alone', () => {
    expect(autoRequestName('soap', 'New SOAP Method', 'https://svc.test/ws/Customer')).toBeNull()
    expect(autoRequestName('websocket', 'New WebSocket', 'wss://echo.test/chat')).toBeNull()
    expect(autoRequestName('graphql', 'New GraphQL', 'https://api.test/graphql')).toBeNull()
  })
})
