/**
 * The Generate Code request matrix (issue #280). `BASELINE_CASES` is the
 * matrix `tests/renderer/baseline-codegen.test.ts` pinned before the rewrite
 * (kept byte-for-byte, so its snapshot keys stay the same); `EXTRA_CASES`
 * covers what that matrix did not (binary / xml / GraphQL bodies, digest,
 * HEAD, request settings) and is used by the per-variant snapshot test.
 */
import type { CodeGenRequest, CodeGenOptions } from '../../src/renderer/lib/code-generator'
import type { KeyValuePair } from '../../src/renderer/types'

let n = 0
export function kv(key: string, value: string, extra: Partial<KeyValuePair> = {}): KeyValuePair {
  n += 1
  return { id: `kv-${n}`, key, value, enabled: true, ...extra }
}

export interface CodegenCase {
  name: string
  req: CodeGenRequest
  options?: CodeGenOptions
  /** The pre-#280 bug this case pinned (fixed by issue #280). */
  knownBug?: string
}

export const BASELINE_CASES: CodegenCase[] = [
  {
    name: 'get-query-headers',
    req: {
      method: 'GET',
      url: 'https://api.example.com/users?active=true',
      params: [
        kv('limit', '10'),
        kv('debug', '1', { enabled: false }),
        kv('active', 'true'), // already in URL -> not duplicated
        kv('q', 'a b&c'),
      ],
      headers: [
        kv('Accept', 'application/json'),
        kv('X-Trace', 'abc'),
        kv('X-Off', 'no', { enabled: false }),
      ],
    },
  },
  {
    name: 'post-json',
    req: {
      method: 'POST',
      url: 'https://api.example.com/users',
      params: [],
      headers: [kv('Content-Type', 'application/json')],
      body: {
        type: 'json',
        content: '{"name":"Ada","admin":true,"manager":null,"tags":["a","b"],"n":1.5}',
      },
    },
    knownBug: 'python JSON literal',
  },
  {
    name: 'post-urlencoded',
    req: {
      method: 'POST',
      url: 'https://api.example.com/login',
      params: [],
      headers: [],
      body: {
        type: 'urlencoded',
        urlEncoded: [
          kv('user', 'ada lovelace'),
          kv('pass', 'p&ss=1'),
          kv('skip', 'x', { enabled: false }),
        ],
      },
    },
    knownBug: 'urlencoded without content-type',
  },
  {
    name: 'post-form-data-text-and-file',
    req: {
      method: 'POST',
      url: 'https://api.example.com/upload',
      params: [],
      headers: [kv('Content-Type', 'multipart/form-data')],
      body: {
        type: 'form-data',
        formData: [
          kv('title', 'My report'),
          kv('file', 'report.pdf', { type: 'file', filePath: '/tmp/report.pdf' }),
        ],
      },
    },
    knownBug: 'form-data dropped outside curl',
  },
  {
    name: 'put-raw-text',
    req: {
      method: 'PUT',
      url: 'https://api.example.com/notes/1',
      params: [],
      headers: [kv('Content-Type', 'text/plain')],
      body: { type: 'text', content: 'hello world' },
    },
  },
  {
    name: 'auth-basic',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'basic', basic: { username: 'admin', password: 's3cret' } },
    },
    knownBug: 'basic auth literal',
  },
  {
    name: 'auth-bearer',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'bearer', bearer: { token: 'tok-123' } },
    },
  },
  {
    name: 'auth-bearer-custom-prefix',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'bearer', bearer: { token: 'tok-123', prefix: 'Token' } },
    },
  },
  {
    name: 'auth-apikey-header',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'api-key', apiKey: { key: 'X-API-Key', value: 'key-1', in: 'header' } },
    },
  },
  {
    name: 'auth-apikey-query',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'api-key', apiKey: { key: 'api_key', value: 'key-1', in: 'query' } },
    },
    knownBug: 'apikey query dropped',
  },
  {
    name: 'placeholders-unresolved',
    req: {
      method: 'POST',
      url: '{{baseUrl}}/users/{{userId}}?token={{token}}',
      params: [kv('page', '{{page}}')],
      headers: [kv('X-Env', '{{envName}}')],
      body: { type: 'json', content: '{"id":"{{userId}}"}' },
      auth: { type: 'bearer', bearer: { token: '{{token}}' } },
    },
  },
  {
    name: 'placeholders-resolved-with-envvars',
    req: {
      method: 'POST',
      url: '{{baseUrl}}/users/{{userId}}',
      params: [kv('page', '{{page}}')],
      headers: [kv('X-Env', '{{envName}}')],
      body: { type: 'json', content: '{"id":"{{userId}}"}' },
      auth: { type: 'bearer', bearer: { token: '{{token}}' } },
    },
    options: {
      envVars: {
        baseUrl: 'https://api.example.com',
        userId: '42',
        page: '2',
        envName: 'dev',
        token: 'real-secret-token',
      },
      secretNames: new Set(['token']), // secret stays as {{token}} unless includeSecrets
    },
  },
  {
    name: 'special-chars-and-quotes',
    req: {
      method: 'POST',
      url: 'https://api.example.com/search/ünï cødé?q=it\'s "quoted"&x=a b#frag',
      params: [kv("o'brien", 'say "hi"')],
      headers: [kv('X-Quote', `it's "mixed" \\ back`)],
      body: {
        type: 'text',
        content: `He said "hello" and it's \\n done $HOME \${x}\nline2 \`tick\``,
      },
    },
    knownBug: 'url fragment / unencoded url / php dollar',
  },
  {
    name: 'special-chars-json-body-quotes',
    req: {
      method: 'POST',
      url: 'https://api.example.com/echo',
      params: [],
      headers: [kv('Content-Type', 'application/json')],
      body: { type: 'json', content: `{"msg":"it's \\"quoted\\"","path":"C:\\\\tmp"}` },
    },
  },
]

export const EXTRA_CASES: CodegenCase[] = [
  {
    name: 'post-xml-no-content-type',
    req: {
      method: 'POST',
      url: 'https://api.example.com/orders',
      params: [],
      headers: [],
      body: { type: 'xml', content: '<order id="1"><item>A&amp;B</item></order>' },
    },
  },
  {
    name: 'put-binary-file',
    req: {
      method: 'PUT',
      url: 'https://api.example.com/files/photo.png',
      params: [],
      headers: [],
      body: { type: 'binary', binaryPath: '/tmp/photo.png' },
    },
  },
  {
    name: 'graphql-query',
    req: {
      method: 'POST',
      url: 'https://api.example.com/graphql',
      params: [],
      headers: [kv('X-Client', 'tn')],
      body: {
        type: 'graphql',
        graphql: {
          query: 'query User($id: ID!) {\n  user(id: $id) { name }\n}',
          variables: '{"id":"7"}',
        },
      },
    },
  },
  {
    name: 'basic-auth-secret-placeholder',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [],
      auth: { type: 'basic', basic: { username: 'admin', password: '{{pass}}' } },
    },
  },
  {
    name: 'user-authorization-beats-auth-tab',
    req: {
      method: 'GET',
      url: 'https://api.example.com/secure',
      params: [],
      headers: [kv('Authorization', 'Custom abc')],
      auth: { type: 'bearer', bearer: { token: 'tok-123' } },
    },
  },
  {
    name: 'head-with-settings',
    req: {
      method: 'HEAD',
      url: 'https://api.example.com/health',
      params: [],
      headers: [],
      settings: { sslVerification: false, timeout: 2500, followRedirects: false },
    },
  },
  {
    name: 'json-body-multiline-lossless',
    req: {
      method: 'PATCH',
      url: 'https://api.example.com/users/1',
      params: [],
      headers: [],
      body: { type: 'json', content: '{\n  "active": false,\n  "note": null\n}' },
    },
  },
]
