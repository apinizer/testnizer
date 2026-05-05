import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest, parseJsonBody, kvList } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('JSON body', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'POST',
    url: `${HTTPBIN}/post`,
    headers: kvList({ 'Content-Type': 'application/json' }),
    body: { type: 'json', content: '{"hello":"world"}' },
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { json: Record<string, unknown> }
  expect(body.json).toEqual({ hello: 'world' })
})

test('form-urlencoded body', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'POST',
    url: `${HTTPBIN}/post`,
    body: {
      type: 'urlencoded',
      urlEncoded: kvList({ name: 'Yıldız', age: '30' }),
    },
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { form: Record<string, string> }
  expect(body.form.name).toBe('Yıldız')
  expect(body.form.age).toBe('30')
})

test('raw text body', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'POST',
    url: `${HTTPBIN}/post`,
    headers: kvList({ 'Content-Type': 'text/plain' }),
    body: { type: 'text', content: 'plain text body' },
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { data: string }
  expect(body.data).toBe('plain text body')
})

test('XML body', async ({ window }) => {
  const xml = '<?xml version="1.0"?><root><a>1</a></root>'
  const res = await sendRequest(window, {
    method: 'POST',
    url: `${HTTPBIN}/post`,
    headers: kvList({ 'Content-Type': 'text/xml' }),
    body: { type: 'xml', content: xml },
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { data: string }
  expect(body.data).toBe(xml)
})
