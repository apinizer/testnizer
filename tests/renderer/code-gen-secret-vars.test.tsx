/**
 * Generate Code / Copy as cURL never embeds a secret variable's value by
 * default (canary scan, release 1.6.0).
 *
 * The scan's cURL carried `Authorization: Bearer <secret token>` and the
 * secret `x-trace` value resolved, plus `?api_key=X&api_key=X` twice. Rule:
 *   - a `secret` env / global variable stays a `{{name}}` placeholder;
 *     "Include secret values" (session-only, off by default) resolves it;
 *   - plain variables resolve as before;
 *   - a query key the URL already carries is not appended again from the
 *     params table (the URL ⇄ Params sync keeps both) — the engine's rule
 *     (`http.engine.ts`, issue #17).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('pre', { 'data-testid': 'monaco' }, value),
}))

import { generateCode } from '../../src/renderer/lib/code-generator'
import {
  activeSecretVariableNames,
  snippetVariables,
} from '../../src/renderer/lib/secret-variables'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import CodeGeneratorModal from '../../src/renderer/components/modals/CodeGeneratorModal'
import RightPanel from '../../src/renderer/components/layout/RightPanel'
import type { Environment, KeyValuePair } from '../../src/renderer/types'

const SECRET = 'CANARY-SECRET-91c2'
const QUERY_KEY = 'CANARY-QUERY-55aa'

function kv(key: string, value: string): KeyValuePair {
  return { id: `${key}-${value}`, key, value, enabled: true }
}

function envVar(key: string, value: string, secret: boolean, enabled = true) {
  return { id: key, key, value, initialValue: value, enabled, secret }
}

function seedEnv(): void {
  const env = {
    id: 'env-1',
    name: 'Dev',
    workspace_id: 'w',
    variables: [envVar('token', SECRET, true), envVar('host', 'api.test', false)],
  } as unknown as Environment
  useEnvironmentStore.setState({
    environments: [env],
    globalVariables: [],
    activeEnvironmentId: 'env-1',
  })
}

// ─── Pure: precedence + filtering ──────────────────────────────────────

describe('activeSecretVariableNames', () => {
  it('follows getActiveVariables precedence (env wins, enabled only)', () => {
    const names = activeSecretVariableNames({
      globalVariables: [
        { key: 'a', enabled: true, secret: true }, // overridden by a plain env var
        { key: 'b', enabled: true, secret: false }, // overridden by a secret env var
        { key: 'c', enabled: true, secret: true },
        { key: 'd', enabled: false, secret: true },
      ],
      environments: [
        {
          id: 'e',
          variables: [
            envVar('a', '1', false),
            envVar('b', '2', true),
            envVar('x', '3', true, false),
          ] as never,
        },
      ],
      activeEnvironmentId: 'e',
    })
    expect([...names].sort()).toEqual(['b', 'c'])
  })

  it('snippetVariables drops secret names unless opted in', () => {
    const vars = { token: SECRET, host: 'h' }
    expect(snippetVariables(vars, new Set(['token']), false)).toEqual({ host: 'h' })
    expect(snippetVariables(vars, new Set(['token']), true)).toEqual(vars)
  })
})

// ─── generateCode ──────────────────────────────────────────────────────

describe('generateCode with secret variables', () => {
  const req = {
    method: 'GET' as const,
    url: 'https://{{host}}/v1/items',
    params: [],
    headers: [kv('Authorization', 'Bearer {{token}}'), kv('X-Host', '{{host}}')],
  }

  it('keeps a secret as {{name}} and resolves plain variables', () => {
    const code = generateCode('curl', req, {
      envVars: { token: SECRET, host: 'api.test' },
      secretNames: new Set(['token']),
    })
    expect(code).not.toContain(SECRET)
    expect(code).toContain("-H 'Authorization: Bearer {{token}}'")
    expect(code).toContain("'https://api.test/v1/items'")
    expect(code).toContain("-H 'X-Host: api.test'")
  })

  it('"Include secret values" resolves the secret', () => {
    const code = generateCode('curl', req, {
      envVars: { token: SECRET, host: 'api.test' },
      secretNames: new Set(['token']),
      includeSecrets: true,
    })
    expect(code).toContain(`Bearer ${SECRET}`)
  })

  it('a plain variable whose value refers to a secret keeps the secret placeholder', () => {
    const code = generateCode(
      'python-requests',
      { ...req, headers: [kv('Authorization', '{{auth}}')] },
      {
        envVars: { auth: 'Bearer {{token}}', token: SECRET, host: 'api.test' },
        secretNames: new Set(['token']),
      },
    )
    expect(code).not.toContain(SECRET)
    expect(code).toContain('Bearer {{token}}')
  })
})

describe('generateCode Authorization tab', () => {
  const req = {
    method: 'GET' as const,
    url: 'https://api.test/me',
    params: [],
    headers: [],
    auth: { type: 'bearer' as const, bearer: { token: '{{token}}' } },
  }
  const opts = { envVars: { token: SECRET }, secretNames: new Set(['token']) }

  it('a secret bearer token stays {{token}} by default', () => {
    const code = generateCode('curl', req, opts)
    expect(code).not.toContain(SECRET)
    expect(code).toContain("-H 'Authorization: Bearer {{token}}'")
  })

  it('"Include secret values" resolves the Auth-tab token too', () => {
    const code = generateCode('curl', req, { ...opts, includeSecrets: true })
    expect(code).toContain(`-H 'Authorization: Bearer ${SECRET}'`)
  })

  it('a plain variable in the Auth tab resolves as headers do', () => {
    const code = generateCode(
      'curl',
      {
        ...req,
        auth: { type: 'bearer', bearer: { token: '{{plain}}' } },
      },
      { envVars: { plain: 'tok-1' } },
    )
    expect(code).toContain("-H 'Authorization: Bearer tok-1'")
  })
})

describe('generateCode query parameters', () => {
  it('does not append a query key the URL already carries (URL ⇄ Params sync)', () => {
    const code = generateCode('curl', {
      method: 'POST',
      url: `http://h.test/v1/chat?api_key=${QUERY_KEY}`,
      params: [kv('api_key', QUERY_KEY)],
      headers: [],
    })
    expect(code.split(QUERY_KEY)).toHaveLength(2)
    expect(code).toContain(`'http://h.test/v1/chat?api_key=${QUERY_KEY}'`)
  })

  it('keeps a repeated-key URL query intact', () => {
    const code = generateCode('curl', {
      method: 'GET',
      url: 'http://h.test/a?id=1&id=2',
      params: [kv('id', '1'), kv('id', '2')],
      headers: [],
    })
    expect(code).toContain("'http://h.test/a?id=1&id=2'")
  })

  it('still appends a params-table key the URL does not carry', () => {
    const code = generateCode('curl', {
      method: 'GET',
      url: 'http://h.test/a?x=1',
      params: [kv('x', '1'), kv('page', '2')],
      headers: [],
    })
    expect(code).toContain("'http://h.test/a?x=1&page=2'")
  })
})

// ─── UI: both Generate Code surfaces ───────────────────────────────────

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.localStorage.clear()
  writeText = vi.fn(async () => undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  seedEnv()
  useRequestStore.setState({
    method: 'GET',
    url: 'https://{{host}}/v1/items',
    params: [],
    headers: [kv('Authorization', 'Bearer {{token}}')],
    body: { type: 'none' } as never,
    auth: { type: 'none' } as never,
  })
})
afterEach(cleanup)

function codeText(): string {
  return screen.getByTestId('monaco').textContent ?? ''
}

describe('Generate Code modal', () => {
  it('hides the secret by default; the toggle includes it', () => {
    useUIStore.setState({ showCodeGenerator: true })
    render(<CodeGeneratorModal />)
    expect(codeText()).not.toContain(SECRET)
    expect(codeText()).toContain('Bearer {{token}}')
    expect(codeText()).toContain('https://api.test/v1/items')

    const toggle = screen.getByTestId('codegen-include-secrets') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    act(() => {
      fireEvent.click(toggle)
    })
    expect(codeText()).toContain(`Bearer ${SECRET}`)
  })
})

describe('Right panel Code pane', () => {
  it('hides the secret by default, does not call it unresolved, and the toggle includes it', () => {
    useUIStore.setState({ rightPanelCollapsed: false, rightPanelTab: 'code' })
    render(<RightPanel />)
    expect(codeText()).not.toContain(SECRET)
    expect(screen.queryByTestId('codegen-unresolved')).toBeNull()
    expect(screen.getByTestId('codegen-secrets-hidden').textContent).toContain('{{token}}')

    act(() => {
      fireEvent.click(screen.getByTestId('codegen-include-secrets'))
    })
    expect(codeText()).toContain(`Bearer ${SECRET}`)
    expect(screen.queryByTestId('codegen-secrets-hidden')).toBeNull()
  })
})
