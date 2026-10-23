/**
 * Issue #276 — path variable cases run on BOTH paths: Send (renderer,
 * tests/renderer/path-variables-send.test.ts) and Run (main,
 * tests/main/handlers/path-variables-run.test.ts). Each case states the path +
 * query the server must receive; `{{base}}` is the only host, so each side
 * points it at its own target.
 */
export interface PathVariableParityCase {
  name: string
  url: string
  pathVariables?: Array<{ key: string; value: string; description?: string }>
  /** Environment variables besides `base`. */
  env?: Record<string, string>
  /** Path + query as the server receives it. */
  expected: string
}

export const PATH_VARIABLE_CASES: PathVariableParityCase[] = [
  {
    name: 'plain value',
    url: '{{base}}/users/:id',
    pathVariables: [{ key: 'id', value: '42' }],
    expected: '/users/42',
  },
  {
    name: 'value with {{var}}, two names, query kept',
    url: '{{base}}/users/:id/posts/:postId?x=1',
    pathVariables: [
      { key: 'id', value: '{{uid}}' },
      { key: 'postId', value: '7' },
    ],
    env: { uid: '9' },
    expected: '/users/9/posts/7?x=1',
  },
  {
    name: 'no rows: literal (requests saved before the field)',
    url: '{{base}}/users/:id',
    expected: '/users/:id',
  },
  {
    name: 'empty value: literal',
    url: '{{base}}/users/:id',
    pathVariables: [{ key: 'id', value: '' }],
    expected: '/users/:id',
  },
]
