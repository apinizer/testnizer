/**
 * `src/shared/mcp-call.ts` — the masking / reading rules Send's History, Run's
 * rows and Run's History share (one implementation since the P-T merge).
 */
import { describe, expect, it } from 'vitest'
import {
  INLINE_MASK,
  coerceTemplated,
  maskMcpArgs,
  mcpSafeCommandLine,
  numberFromText,
  tokenizeCommandLine,
  mcpDisplayTarget,
  mcpHistoryRequest,
  readSavedMcpCall,
  resolveSavedMcpCall,
} from '../../../src/shared/mcp-call'

const id = (s: string): string => s

describe('mcpDisplayTarget', () => {
  it('http: strips userinfo and masks credential-named query values', () => {
    expect(mcpDisplayTarget('http', 'https://u:p@h.test/mcp?api_key=k1&x=1')).toBe(
      'https://h.test/mcp?api_key=***&x=1',
    )
    expect(mcpDisplayTarget('sse', 'https://h.test/sse')).toBe('https://h.test/sse')
    expect(mcpDisplayTarget('http', '{{base}}/mcp')).toBe('{{base}}/mcp')
  })

  it('stdio: quote-aware, credential flags masked, spaced tokens quoted', () => {
    expect(
      mcpDisplayTarget(
        'stdio',
        'npx -y srv --api-key abc --token=xyz "/My Docs" https://u:p@h.test/?secret=s',
      ),
    ).toBe('npx -y srv --api-key *** --token=*** "/My Docs" https://h.test/?secret=***')
  })
})

describe('maskMcpArgs', () => {
  it('masks credential-named STRING values recursively with the given mask', () => {
    const args = { text: 'hi', api_key: 'k', nested: [{ token: 't', max_tokens: 5 }], session: '' }
    expect(maskMcpArgs(args, INLINE_MASK)).toEqual({
      text: 'hi',
      api_key: '***',
      nested: [{ token: '***', max_tokens: 5 }],
      session: '',
    })
  })

  it('history snapshot masks args, keeps the URI as is', () => {
    const conn = { transport: 'http' as const, url: 'https://h.test/mcp', protocol: 'auto' }
    expect(
      mcpHistoryRequest(conn, { capability: 'tool', name: 'echo', args: { password: 'p' } }, '••'),
    ).toEqual({ ...conn, capability: 'tool', name: 'echo', args: { password: '••' } })
    expect(mcpHistoryRequest(conn, { capability: 'resource', uri: 'x://1' }, '••')).toEqual({
      ...conn,
      capability: 'resource',
      uri: 'x://1',
    })
  })
})

describe('resolveSavedMcpCall', () => {
  it('reports an incomplete definition as a config problem, a broken value as a failure', () => {
    expect(resolveSavedMcpCall({}, id)).toMatchObject({ problem: 'noTool', configError: true })
    expect(resolveSavedMcpCall({ capabilityTab: 'prompts' }, id)).toMatchObject({
      problem: 'noPrompt',
      configError: true,
    })
    expect(resolveSavedMcpCall({ capabilityTab: 'resources' }, id)).toMatchObject({
      problem: 'noResource',
      configError: true,
    })
    expect(resolveSavedMcpCall({ selectedTool: 't', toolArgs: '{"a": {{x}}}' }, id)).toMatchObject({
      problem: 'argsJson',
      configError: false,
    })
    expect(resolveSavedMcpCall({ selectedTool: 't', toolArgs: '[1]' }, id)).toMatchObject({
      problem: 'argsNotObject',
    })
    expect(
      resolveSavedMcpCall({ capabilityTab: 'resources', resourceUriDraft: 'x://{id}' }, id),
    ).toMatchObject({ problem: 'uriTemplate', uri: 'x://{id}' })
    expect(
      resolveSavedMcpCall({ capabilityTab: 'resources', resourceUriDraft: '{{u}}' }, () => ''),
    ).toMatchObject({ problem: 'uriEmpty', configError: false })
  })

  it('keeps the unresolved parse for a later schema step', () => {
    const r = resolveSavedMcpCall({ selectedTool: 't', toolArgs: '{"a":"{{n}}"}' }, (s) =>
      s.replace('{{n}}', '5'),
    )
    expect(r.call).toEqual({
      capability: 'tool',
      name: 't',
      args: { a: '5' },
      rawArgs: { a: '{{n}}' },
    })
  })

  it('reads a saved call tolerantly (the reader both paths use)', () => {
    expect(
      readSavedMcpCall({ capabilityTab: 'nope', toolArgs: 3, promptArgs: { a: 1, b: 'x' } }),
    ).toEqual({
      promptArgs: { b: 'x' },
    })
  })
})

describe('arg masking uses a word rule, not the broad header rule (review item 1)', () => {
  it('does NOT mask ordinary arguments that merely contain a credential substring', () => {
    const args = {
      author: 'Tolkien',
      keyword: 'ring',
      authority: 'gov',
      monkey: 'george',
      max_tokens: 'many',
      tokenizer: 'bpe',
      keyboard: 'qwerty',
    }
    expect(maskMcpArgs(args, INLINE_MASK)).toEqual(args)
  })

  it('masks credential-named arguments in every spelling', () => {
    const secret = {
      api_key: 'a',
      apiKey: 'b',
      APIKey: 'c',
      'x-api-key': 'd',
      apikey: 'e',
      access_token: 'f',
      accessToken: 'g',
      accesstoken: 'h',
      password: 'i',
      passwd: 'j',
      clientSecret: 'k',
      client_secret: 'l',
      auth: 'm',
      Authorization: 'n',
      key: 'o',
      session: 'p',
      cookie: 'q',
      signature: 'r',
      credentials: 's',
      bearer: 't',
      refresh_token: 'u',
      private_key: 'v',
    }
    const masked = maskMcpArgs(secret, INLINE_MASK) as Record<string, unknown>
    for (const k of Object.keys(secret)) expect([k, masked[k]]).toEqual([k, INLINE_MASK])
  })
})

describe('mcpSafeCommandLine quotes without escaping (review item 15)', () => {
  it('a Windows path with a space round-trips through tokenizeCommandLine', () => {
    const parts = ['node', 'C:\\Program Files\\srv\\index.js', '--name', 'my "srv"']
    const line = mcpSafeCommandLine(parts)
    expect(line).toBe('node "C:\\Program Files\\srv\\index.js" --name \'my "srv"\'')
    expect(tokenizeCommandLine(line)).toEqual(parts)
  })
})

describe('numberFromText — the one number rule Form view and {{var}} coercion share (item 5)', () => {
  it('number: canonical and non-canonical decimals are numbers', () => {
    expect(numberFromText('0.70', 'number')).toBe(0.7)
    expect(numberFromText('1.0', 'number')).toBe(1)
    expect(numberFromText('2.50', 'number')).toBe(2.5)
    expect(numberFromText('-3', 'number')).toBe(-3)
    expect(numberFromText('1.', 'number')).toBeUndefined()
    expect(numberFromText('abc', 'number')).toBeUndefined()
  })

  it('integer: only whole numbers — fractional text is not an integer', () => {
    expect(numberFromText('10', 'integer')).toBe(10)
    expect(numberFromText('1.0', 'integer')).toBeUndefined()
    expect(numberFromText('2.5', 'integer')).toBeUndefined()
  })

  it('a {{var}} resolving to 0.70 in a number field is sent as a number', () => {
    expect(coerceTemplated('{{v}}', '0.70', { type: 'number' })).toBe(0.7)
  })
})

describe('joinCommandLine / mcpSafeCommandLine with both quote kinds in one token', () => {
  it('round-trips', () => {
    const parts = ['srv', `say "it's"`]
    expect(tokenizeCommandLine(mcpSafeCommandLine(parts))).toEqual(parts)
  })
})
