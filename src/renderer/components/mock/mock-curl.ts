/**
 * "Copy as cURL" of a mock endpoint (the editor's URL bar). An endpoint with
 * an AI reply (`llm`, issue #221, design §6.5.3) gets a streaming chat
 * request in its provider's shape — `-N` so curl prints the chunks as they
 * arrive; Anthropic adds `anthropic-version` and the `max_tokens` it
 * requires. Every other endpoint keeps the plain method + JSON placeholder.
 */
import type { MockLlmProvider } from '../../../shared/mock-stream'
import { renderCurl, type CurlArg } from '../../../shared/curl'
import type { MockEndpoint, MockServer } from '../../types'
import { MOCK_LLM_MODEL } from './mock-ai-presets'

const MESSAGES = [{ role: 'user', content: 'Hello' }]

/**
 * The request a client sends to a mock endpoint — the ONE decision behind both
 * "Copy as cURL" and "Open in request tab" (`mock-open-in-tab.ts`), so the two
 * never disagree on method, headers or body.
 */
export interface MockRequestShape {
  /** ANY → GET (an AI reply: POST). */
  method: Exclude<MockEndpoint['method'], 'ANY'>
  headers: { name: string; value: string }[]
  /** JSON text, or null for no body. */
  body: string | null
  /** An AI reply streams its answer (cURL `-N`). */
  stream: boolean
}

export function mockRequestShape(
  endpoint: Pick<MockEndpoint, 'method'>,
  /** Provider of the endpoint's `llm` reply, or null when it has none. */
  llm: MockLlmProvider | null,
): MockRequestShape {
  if (llm) {
    const body =
      llm === 'anthropic'
        ? { model: MOCK_LLM_MODEL, stream: true, max_tokens: 256, messages: MESSAGES }
        : { model: MOCK_LLM_MODEL, stream: true, messages: MESSAGES }
    return {
      method: endpoint.method === 'ANY' ? 'POST' : endpoint.method,
      headers: [
        { name: 'content-type', value: 'application/json' },
        ...(llm === 'anthropic' ? [{ name: 'anthropic-version', value: '2023-06-01' }] : []),
      ],
      body: JSON.stringify(body),
      stream: true,
    }
  }
  const method = endpoint.method === 'ANY' ? 'GET' : endpoint.method
  // For methods that typically carry a body, hint at a placeholder content-type + body.
  const withBody = method === 'POST' || method === 'PUT' || method === 'PATCH'
  return {
    method,
    headers: withBody ? [{ name: 'Content-Type', value: 'application/json' }] : [],
    body: withBody ? '{}' : null,
    stream: false,
  }
}

export function buildMockCurl(
  server: Pick<MockServer, 'host' | 'port' | 'basePath'>,
  endpoint: Pick<MockEndpoint, 'method' | 'path'>,
  /** Provider of the endpoint's `llm` reply, or null when it has none. */
  llm: MockLlmProvider | null,
): string {
  const url = `http://${server.host}:${server.port}${server.basePath}${endpoint.path}`
  // Quoting + layout: the shared cURL generator (issue #279). Same output as
  // before, except a URL containing `'` is now escaped (`'\''`) instead of
  // breaking the command.
  const shape = mockRequestShape(endpoint, llm)
  // An AI reply is a streaming POST implied by `-d`; everything else names its method.
  const args: CurlArg[] = shape.stream
    ? [{ flag: '-N' }, { value: url }]
    : [{ flag: '-X', value: shape.method, literal: true }, { value: url }]
  for (const h of shape.headers) args.push({ flag: '-H', value: `${h.name}: ${h.value}` })
  if (shape.body !== null) args.push({ flag: '-d', value: shape.body })
  return renderCurl(args, { inline: 2 })
}
