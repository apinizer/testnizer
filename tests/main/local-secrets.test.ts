/**
 * Unit cases for the issue #177 strip / keep-local helpers. The end-to-end
 * behaviour (save boundaries, import modes, real git) lives in
 * tests/main/handlers/project-local-secrets.test.ts and git-two-machines.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  stripLocalSecrets,
  stripMockAuthJson,
  mergeMockAuthJson,
  keepLocalVariableSecrets,
  keepLocalMcpBearer,
  keepLocalCertSecrets,
  localSecretsByKey,
  keepLocalSecretByKey,
  keepLocalMockAuth,
  keepLocalMaskedText,
  isMockAuthSecretField,
  mockAuthSecretValues,
} from '../../src/main/lib/local-secrets'

describe('stripMockAuthJson', () => {
  it('leaves "" (no endpoint override), none and unparseable values alone', () => {
    expect(stripMockAuthJson('')).toBe('')
    const none = '{"type":"none"}'
    expect(stripMockAuthJson(none)).toBe(none)
    expect(stripMockAuthJson('{not json')).toBe('{not json')
    expect(stripMockAuthJson(null)).toBeNull()
  })

  it('keeps structure, blanks only the secret values', () => {
    expect(
      JSON.parse(
        stripMockAuthJson(
          JSON.stringify({ type: 'apiKey', in: 'query', name: 'k', keys: ['a', 'b'] }),
        ) as string,
      ),
    ).toEqual({ type: 'apiKey', in: 'query', name: 'k', keys: ['', ''] })
  })
})

describe('mergeMockAuthJson', () => {
  const local = JSON.stringify({ type: 'bearer', tokens: ['l1', 'l2'] })

  it('refills blank tokens by position', () => {
    const merged = mergeMockAuthJson(JSON.stringify({ type: 'bearer', tokens: ['', ''] }), local)
    expect(JSON.parse(merged as string)).toEqual({ type: 'bearer', tokens: ['l1', 'l2'] })
  })

  it('a token added on the other machine stays blank here (no local counterpart)', () => {
    const merged = mergeMockAuthJson(
      JSON.stringify({ type: 'bearer', tokens: ['', '', ''] }),
      local,
    )
    expect(JSON.parse(merged as string).tokens).toEqual(['l1', 'l2', ''])
  })

  it('does nothing when the auth type changed', () => {
    const incoming = JSON.stringify({ type: 'apiKey', in: 'header', name: 'X', keys: [''] })
    expect(mergeMockAuthJson(incoming, local)).toBe(incoming)
  })

  it('a non-blank incoming value (pre-#177 file) wins', () => {
    const incoming = JSON.stringify({ type: 'bearer', tokens: ['remote', ''] })
    expect(JSON.parse(mergeMockAuthJson(incoming, local) as string).tokens).toEqual([
      'remote',
      'l2',
    ])
  })

  it('basic users match by username; unknown users stay blank', () => {
    const merged = mergeMockAuthJson(
      JSON.stringify({
        type: 'basic',
        users: [
          { username: 'carol', password: '' },
          { username: 'alice', password: '' },
        ],
      }),
      JSON.stringify({ type: 'basic', users: [{ username: 'alice', password: 'pw' }] }),
    )
    expect(JSON.parse(merged as string).users).toEqual([
      { username: 'carol', password: '' },
      { username: 'alice', password: 'pw' },
    ])
  })
})

describe('stripLocalSecrets', () => {
  it('is idempotent and does not mutate its input', () => {
    const input = {
      environmentVariables: [{ id: 'v', secret: 1, value: 'x', initial_value: 'y' }],
      globalVariables: [{ id: 'g', secret: 0, value: 'plain', initial_value: 'plain' }],
      mockMcpServers: [{ id: 'm', bearer_token: 't' }],
    }
    const once = stripLocalSecrets(input)
    expect(stripLocalSecrets(once)).toEqual(once)
    expect(input.environmentVariables[0].value).toBe('x')
    expect(once.environmentVariables![0]).toMatchObject({ value: '', initial_value: '' })
    expect(once.globalVariables![0]).toMatchObject({ value: 'plain' })
    expect(once.mockMcpServers![0].bearer_token).toBe('')
  })
})

describe('keep-local import helpers', () => {
  it('variables: only secret rows with a blank incoming value take the local value', () => {
    const local: Record<string, Record<string, unknown>> = {
      s: { value: 'L', initial_value: 'LI' },
      p: { value: 'L', initial_value: 'LI' },
    }
    const out = keepLocalVariableSecrets(
      [
        { id: 's', secret: 1, value: '', initial_value: '' },
        { id: 'p', secret: 0, value: '', initial_value: '' },
        { id: 'new', secret: 1, value: '', initial_value: '' },
      ],
      (id) => local[id],
    )
    expect(out[0]).toMatchObject({ value: 'L', initial_value: 'LI' })
    expect(out[1]).toMatchObject({ value: '', initial_value: '' })
    expect(out[2]).toMatchObject({ value: '', initial_value: '' })
  })

  it('MCP bearer: blank / missing incoming keeps local, never NULL', () => {
    const out = keepLocalMcpBearer(
      [{ id: 'a', bearer_token: '' }, { id: 'b' }, { id: 'c', bearer_token: 'remote' }],
      (id) => (id === 'a' ? { bearer_token: 'local' } : undefined),
    )
    expect(out.map((r) => r.bearer_token)).toEqual(['local', '', 'remote'])
  })
})

describe('certificate secrets (issue #177)', () => {
  it('strip blanks passphrase + keystore entry password; NULL stays NULL', () => {
    const out = stripLocalSecrets({
      certificates: [
        { id: 'a', passphrase: 'enc:pp', keystore_key_password: 'kp', host: 'h' },
        { id: 'b', passphrase: null, keystore_key_password: null },
      ],
    })
    expect(out.certificates).toEqual([
      { id: 'a', passphrase: '', keystore_key_password: '', host: 'h' },
      { id: 'b', passphrase: null, keystore_key_password: null },
    ])
  })

  it('keep-local: a non-blank local value wins over "" and over foreign ciphertext', () => {
    const local: Record<string, Record<string, unknown>> = {
      a: { passphrase: 'enc:mine', keystore_key_password: 'mine-kp' },
      b: { passphrase: null, keystore_key_password: '' },
    }
    const out = keepLocalCertSecrets(
      [
        { id: 'a', passphrase: '', keystore_key_password: 'enc:theirs' },
        { id: 'b', passphrase: 'enc:theirs', keystore_key_password: '' },
        { id: 'new', passphrase: '', keystore_key_password: '' },
      ],
      (id) => local[id],
    )
    expect(out[0]).toMatchObject({ passphrase: 'enc:mine', keystore_key_password: 'mine-kp' })
    expect(out[1]).toMatchObject({ passphrase: 'enc:theirs', keystore_key_password: '' })
    expect(out[2]).toMatchObject({ passphrase: '', keystore_key_password: '' })
  })
})

describe('keep-local by variable key (Postman re-import, issue #177)', () => {
  const local = localSecretsByKey([
    { key: 'token', secret: 1, value: 'L', initial_value: 'LI' },
    { key: 'plain', secret: 0, value: 'P', initial_value: 'PI' },
  ])

  it('a blank incoming secret takes the local secret row of the same key', () => {
    expect(
      keepLocalSecretByKey({ key: 'token', secret: true, value: '', initial_value: '' }, local),
    ).toEqual({ value: 'L', initial_value: 'LI' })
    expect(
      keepLocalSecretByKey({ key: 'token', secret: true, value: '', initial_value: null }, local),
    ).toEqual({ value: 'L', initial_value: 'LI' })
  })

  it('a non-blank incoming value, a non-secret row, an unknown key or a non-secret local stay as-is', () => {
    expect(
      keepLocalSecretByKey({ key: 'token', secret: true, value: 'R', initial_value: 'R' }, local),
    ).toEqual({ value: 'R', initial_value: 'R' })
    expect(
      keepLocalSecretByKey({ key: 'token', secret: false, value: '', initial_value: '' }, local),
    ).toEqual({ value: '', initial_value: '' })
    expect(
      keepLocalSecretByKey({ key: 'other', secret: true, value: '', initial_value: '' }, local),
    ).toEqual({ value: '', initial_value: '' })
    expect(
      keepLocalSecretByKey({ key: 'plain', secret: true, value: '', initial_value: '' }, local),
    ).toEqual({ value: '', initial_value: '' })
  })
})

// Issue #177 re-open: Auth Config is a free JSON textarea, so the strip works
// by field name (shared `isCredentialArgName` rule + plurals + `value`), at
// any depth, and survives a JSON string typed into the field.
describe('mock auth: every shape the editor can store (issue #177 re-open)', () => {
  const shapes: {
    name: string
    auth: Record<string, unknown>
    stripped: Record<string, unknown>
  }[] = [
    {
      name: 'canonical bearer',
      auth: { type: 'bearer', tokens: ['t-one-111', 't-two-222'] },
      stripped: { type: 'bearer', tokens: ['', ''] },
    },
    {
      name: 'single bearer token',
      auth: { type: 'bearer', token: 'single-tok-333' },
      stripped: { type: 'bearer', token: '' },
    },
    {
      name: 'nested bearer object',
      auth: { type: 'bearer', bearer: { token: 'nested-tok-444', prefix: 'Bearer' } },
      stripped: { type: 'bearer', bearer: { token: '', prefix: 'Bearer' } },
    },
    {
      name: 'canonical basic',
      auth: { type: 'basic', users: [{ username: 'alice', password: 'alice-pw-555' }] },
      stripped: { type: 'basic', users: [{ username: 'alice', password: '' }] },
    },
    {
      name: 'flat basic',
      auth: { type: 'basic', username: 'qa', password: 'flat-pw-666' },
      stripped: { type: 'basic', username: 'qa', password: '' },
    },
    {
      name: 'canonical apiKey',
      auth: { type: 'apiKey', in: 'header', name: 'X-API-Key', keys: ['key-777-aaa'] },
      stripped: { type: 'apiKey', in: 'header', name: 'X-API-Key', keys: [''] },
    },
    {
      name: 'apiKey as value',
      auth: { type: 'apiKey', in: 'query', name: 'api_key', value: 'val-888-bbb' },
      stripped: { type: 'apiKey', in: 'query', name: 'api_key', value: '' },
    },
    {
      name: 'apiKey field',
      auth: { type: 'apiKey', in: 'header', name: 'X-Key', apiKey: 'apikey-999-ccc' },
      stripped: { type: 'apiKey', in: 'header', name: 'X-Key', apiKey: '' },
    },
    {
      name: 'secrets list',
      auth: { type: 'bearer', secrets: ['sec-000-ddd'] },
      stripped: { type: 'bearer', secrets: [''] },
    },
  ]

  for (const { name, auth, stripped } of shapes) {
    it(`${name}: strip blanks the secret, keeps the structure, merge restores it`, () => {
      const raw = JSON.stringify(auth)
      const out = stripMockAuthJson(raw) as string
      expect(JSON.parse(out)).toEqual(stripped)
      for (const v of mockAuthSecretValues(raw)) expect(out).not.toContain(v)
      // Idempotent.
      expect(stripMockAuthJson(out)).toBe(out)
      // Keep-local brings the exact original back.
      expect(JSON.parse(mergeMockAuthJson(out, raw) as string)).toEqual(auth)
    })
  }

  it('a JSON string typed into the field (stored double-encoded) is stripped and restored in that form', () => {
    const raw = JSON.stringify(JSON.stringify({ type: 'bearer', tokens: ['dbl-tok-123456'] }))
    const out = stripMockAuthJson(raw) as string
    expect(out).not.toContain('dbl-tok-123456')
    expect(JSON.parse(JSON.parse(out) as string)).toEqual({ type: 'bearer', tokens: [''] })
    expect(mergeMockAuthJson(out, raw)).toBe(raw)
  })

  it('structural names never count as secrets; credential names and plurals do', () => {
    for (const f of ['type', 'in', 'name', 'username', 'users', 'header', 'realm']) {
      expect(isMockAuthSecretField(f), f).toBe(false)
    }
    for (const f of [
      'token',
      'tokens',
      'keys',
      'password',
      'apiKey',
      'secret',
      'value',
      'values',
    ]) {
      expect(isMockAuthSecretField(f), f).toBe(true)
    }
  })

  it('stripLocalSecrets scrubs mock auth secrets out of server and endpoint descriptions', () => {
    const out = stripLocalSecrets({
      mockServers: [
        {
          id: 's',
          description: 'Requests need "Authorization: Bearer mock_abcdef123456"',
          auth_config: JSON.stringify({ type: 'bearer', tokens: ['mock_abcdef123456'] }),
        },
      ],
      mockEndpoints: [
        {
          id: 'e',
          description: 'basic pw is endpoint-pw-42 / bearer mock_abcdef123456',
          auth_override: JSON.stringify({
            type: 'basic',
            users: [{ username: 'u', password: 'endpoint-pw-42' }],
          }),
        },
      ],
    })
    expect(out.mockServers![0].description).toBe('Requests need "Authorization: Bearer ••••••"')
    expect(out.mockEndpoints![0].description).toBe('basic pw is •••••• / bearer ••••••')
  })

  it('keep-local: a masked description keeps the local text only when it is the same text', () => {
    const local = 'Requests need "Authorization: Bearer mock_abcdef123456"'
    const masked = 'Requests need "Authorization: Bearer ••••••"'
    expect(keepLocalMaskedText(masked, local)).toBe(local)
    // The teammate rewrote the description: theirs wins.
    expect(keepLocalMaskedText('New text ••••••', local)).toBe('New text ••••••')
    // No mask → nothing to restore.
    expect(keepLocalMaskedText('plain', local)).toBe('plain')

    const rows = keepLocalMockAuth(
      [
        {
          id: 's',
          description: masked,
          auth_config: JSON.stringify({ type: 'bearer', tokens: [''] }),
        },
      ],
      'auth_config',
      () => ({
        description: local,
        auth_config: JSON.stringify({ type: 'bearer', tokens: ['mock_abcdef123456'] }),
      }),
    )
    expect(rows[0].description).toBe(local)
    expect(JSON.parse(rows[0].auth_config as string)).toEqual({
      type: 'bearer',
      tokens: ['mock_abcdef123456'],
    })
  })

  it('keep-local never adds a description key the incoming row did not have', () => {
    const rows = keepLocalMockAuth(
      [{ id: 's', auth_config: JSON.stringify({ type: 'bearer', tokens: [''] }) }],
      'auth_config',
      () => ({ description: 'x', auth_config: JSON.stringify({ type: 'bearer', tokens: ['t'] }) }),
    )
    expect('description' in rows[0]).toBe(false)
  })
})
