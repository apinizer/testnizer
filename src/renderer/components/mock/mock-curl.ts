/**
 * "Copy as cURL" of a mock endpoint (the editor's URL bar). An endpoint with
 * an AI reply (`llm`, issue #221, design §6.5.3) gets a streaming chat
 * request in its provider's shape — `-N` so curl prints the chunks as they
 * arrive; Anthropic adds `anthropic-version` and the `max_tokens` it
 * requires. Every other endpoint keeps the plain method + JSON placeholder.
 */
import type { MockLlmProvider } from '../../../shared/mock-stream'
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
  if (llm) {
    const body =
      llm === 'anthropic'
        ? { model: MOCK_LLM_MODEL, stream: true, max_tokens: 256, messages: MESSAGES }
        : { model: MOCK_LLM_MODEL, stream: true, messages: MESSAGES }
    return [
      `curl -N '${url}'`,
      `-H 'content-type: application/json'`,
      ...(llm === 'anthropic' ? [`-H 'anthropic-version: 2023-06-01'`] : []),
      `-d '${JSON.stringify(body)}'`,
    ].join(' \\\n  ')
  }
  const method = endpoint.method === 'ANY' ? 'GET' : endpoint.method
  const parts = [`curl -X ${method} '${url}'`]
  // For methods that typically carry a body, hint at a placeholder content-type + body.
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    parts.push(`-H 'Content-Type: application/json'`)
    parts.push(`-d '{}'`)
  }
  return parts.join(' \\\n  ')
}
