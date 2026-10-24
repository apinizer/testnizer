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
  if (llm) {
    const body =
      llm === 'anthropic'
        ? { model: MOCK_LLM_MODEL, stream: true, max_tokens: 256, messages: MESSAGES }
        : { model: MOCK_LLM_MODEL, stream: true, messages: MESSAGES }
    const args: CurlArg[] = [
      { flag: '-N' },
      { value: url },
      { flag: '-H', value: 'content-type: application/json' },
      ...(llm === 'anthropic' ? [{ flag: '-H', value: 'anthropic-version: 2023-06-01' }] : []),
      { flag: '-d', value: JSON.stringify(body) },
    ]
    return renderCurl(args, { inline: 2 })
  }
  const method = endpoint.method === 'ANY' ? 'GET' : endpoint.method
  const args: CurlArg[] = [{ flag: '-X', value: method, literal: true }, { value: url }]
  // For methods that typically carry a body, hint at a placeholder content-type + body.
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    args.push({ flag: '-H', value: 'Content-Type: application/json' })
    args.push({ flag: '-d', value: '{}' })
  }
  return renderCurl(args, { inline: 2 })
}
