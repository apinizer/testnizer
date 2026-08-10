/**
 * Smoke-render the request editor and every one of its tabs against a seeded
 * request store + mocked window.api. A screen that throws on mount becomes a
 * RED test here (see `mountsWithoutCrash`), not a white-screen in production.
 */
import * as React from 'react'
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Monaco can't run in jsdom — stub it (mirrors the existing renderer tests).
vi.mock('../../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mountsWithoutCrash, mockWindowApi } from './_mount'
import { useRequestStore } from '../../../src/renderer/stores/request.store'
import RequestEditor from '../../../src/renderer/components/request/RequestEditor'
import ParamsTab from '../../../src/renderer/components/request/ParamsTab'
import HeadersTab from '../../../src/renderer/components/request/HeadersTab'
import AuthTab from '../../../src/renderer/components/request/AuthTab'
import BodyTab from '../../../src/renderer/components/request/BodyTab'
import ScriptsTab from '../../../src/renderer/components/request/ScriptsTab'
import TestsTab from '../../../src/renderer/components/request/TestsTab'
import SettingsTab from '../../../src/renderer/components/request/SettingsTab'
import PreRequestTab from '../../../src/renderer/components/request/PreRequestTab'
import type { AuthConfig, AuthType, BodyType, RequestBody } from '../../../src/renderer/types'

function seedRequestStore(): void {
  useRequestStore.setState({
    method: 'POST',
    url: 'https://api.example.com/users?q=1',
    params: [{ id: 'p1', key: 'q', value: '1', enabled: true }],
    headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json', enabled: true }],
    body: { type: 'json', content: '{"a":1}' },
    auth: { type: 'bearer', bearer: { token: '{{token}}' } },
    preScript: 'console.log("pre")',
    postScript: 'pm.test("ok", () => pm.expect(1).to.equal(1))',
    assertions: [
      { id: 'a1', name: 'Status is 200', type: 'status_equals', enabled: true, expected: 200 },
    ],
    followRedirects: true,
    maxRedirects: 5,
    sslVerification: true,
    requestTimeout: null,
  })
}

beforeEach(() => {
  mockWindowApi()
  seedRequestStore()
})

afterEach(() => {
  cleanup()
})

describe('Request screens — smoke mount', () => {
  it('RequestEditor (tab shell)', () => {
    mountsWithoutCrash(<RequestEditor />)
  })

  it('ParamsTab', () => {
    mountsWithoutCrash(<ParamsTab />)
  })

  it('HeadersTab', () => {
    mountsWithoutCrash(<HeadersTab />)
  })

  it('AuthTab', () => {
    mountsWithoutCrash(<AuthTab />)
  })

  it('BodyTab', () => {
    mountsWithoutCrash(<BodyTab />)
  })

  it('ScriptsTab', () => {
    mountsWithoutCrash(<ScriptsTab />)
  })

  it('TestsTab', () => {
    mountsWithoutCrash(<TestsTab />)
  })

  it('SettingsTab', () => {
    mountsWithoutCrash(<SettingsTab />)
  })

  it('PreRequestTab', () => {
    mountsWithoutCrash(<PreRequestTab />)
  })
})

// Each auth type renders a different branch of AuthTab — exercise them all so a
// broken credential form surfaces immediately.
const AUTH_CASES: { type: AuthType; auth: AuthConfig }[] = [
  { type: 'none', auth: { type: 'none' } },
  { type: 'inherit', auth: { type: 'inherit' } },
  { type: 'bearer', auth: { type: 'bearer', bearer: { token: 't' } } },
  { type: 'basic', auth: { type: 'basic', basic: { username: 'u', password: 'p' } } },
  { type: 'api-key', auth: { type: 'api-key', apiKey: { key: 'X-Key', value: 'v', in: 'header' } } },
  {
    type: 'oauth2',
    auth: {
      type: 'oauth2',
      oauth2: { grantType: 'client_credentials', tokenUrl: 'https://t', clientId: 'c' },
    },
  },
  { type: 'digest', auth: { type: 'digest', digest: { username: 'u', password: 'p' } } },
  { type: 'ntlm', auth: { type: 'ntlm', ntlm: { username: 'u', password: 'p' } } },
  { type: 'wsse', auth: { type: 'wsse' } },
]

describe('AuthTab — per auth type', () => {
  it.each(AUTH_CASES)('renders auth type "$type"', ({ auth }) => {
    useRequestStore.setState({ auth })
    mountsWithoutCrash(<AuthTab />)
  })
})

// Each body type is a distinct render branch (raw editor / KV tables / binary
// picker / empty). Smoke each.
const BODY_CASES: { type: BodyType; body: RequestBody }[] = [
  { type: 'none', body: { type: 'none' } },
  { type: 'json', body: { type: 'json', content: '{"a":1}' } },
  { type: 'xml', body: { type: 'xml', content: '<a>1</a>' } },
  { type: 'text', body: { type: 'text', content: 'hi' } },
  { type: 'html', body: { type: 'html', content: '<p>hi</p>' } },
  { type: 'javascript', body: { type: 'javascript', content: 'const a=1' } },
  {
    type: 'form-data',
    body: { type: 'form-data', formData: [{ id: 'f1', key: 'k', value: 'v', enabled: true }] },
  },
  {
    type: 'urlencoded',
    body: { type: 'urlencoded', urlEncoded: [{ id: 'u1', key: 'k', value: 'v', enabled: true }] },
  },
  { type: 'binary', body: { type: 'binary', binaryPath: '/tmp/x.bin' } },
]

describe('BodyTab — per body type', () => {
  it.each(BODY_CASES)('renders body type "$type"', ({ body }) => {
    useRequestStore.setState({ body })
    mountsWithoutCrash(<BodyTab />)
  })
})
