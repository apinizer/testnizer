// src/main/protocols/ai-chat.engine.ts
// AI chat completions engine — supports OpenAI / Anthropic / OpenRouter / custom URL.
//
// Streams Server-Sent Events from the chat completion endpoint and yields
// incremental text deltas. Supports cancellation via AbortSignal.
//
// Renderer never touches the network directly; it talks to ai-chat.handler.ts
// which drives this engine.

export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'mistral'
  | 'groq'
  | 'perplexity'
  | 'cerebras'
  | 'cohere'
  | 'fireworks'
  | 'deepinfra'
  | 'together'
  | 'custom'

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AiStreamOptions {
  provider: AiProvider
  /** Required when provider === 'custom'; otherwise overrides the default URL. */
  url?: string
  apiKey: string
  model: string
  messages: AiChatMessage[]
  /** Optional generation knobs forwarded to the provider. */
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface AiStreamChunk {
  /** Incremental text delta for this chunk. */
  delta: string
}

// ─── URL + body builders (exported for unit testing) ─────────

// Default chat-completions endpoints for each provider. All non-Anthropic
// providers use OpenAI-compatible request/response shapes — we just point at
// each vendor's chat-completions URL.
const PROVIDER_DEFAULT_URLS: Record<Exclude<AiProvider, 'custom'>, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  perplexity: 'https://api.perplexity.ai/chat/completions',
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
  cohere: 'https://api.cohere.com/compatibility/v1/chat/completions',
  fireworks: 'https://api.fireworks.ai/inference/v1/chat/completions',
  deepinfra: 'https://api.deepinfra.com/v1/openai/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions',
}

export function resolveProviderUrl(provider: AiProvider, customUrl?: string): string {
  if (provider === 'custom') {
    if (!customUrl || !customUrl.trim()) {
      throw new Error('Custom provider requires a URL')
    }
    return customUrl.trim()
  }
  if (customUrl && customUrl.trim()) {
    // Allow user override even on built-in providers (e.g., Azure OpenAI proxy).
    return customUrl.trim()
  }
  const url = PROVIDER_DEFAULT_URLS[provider]
  if (!url) throw new Error(`Unknown provider: ${provider as string}`)
  return url
}

export function buildHeaders(provider: AiProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    // openai / openrouter / custom — Bearer is the most common pattern
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://testnizer.app'
    headers['X-Title'] = 'Testnizer'
  }
  return headers
}

export interface BuildBodyOptions {
  provider: AiProvider
  model: string
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
}

export function buildBody(opts: BuildBodyOptions): Record<string, unknown> {
  const { provider, model, messages, temperature, maxTokens } = opts

  if (provider === 'anthropic') {
    // Anthropic puts system prompt at the top level rather than in messages[].
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const nonSystem = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))
    const body: Record<string, unknown> = {
      model,
      messages: nonSystem,
      stream: true,
      max_tokens: maxTokens ?? 1024,
    }
    if (system.length > 0) body.system = system
    if (temperature !== undefined) body.temperature = temperature
    return body
  }

  // OpenAI / OpenRouter / custom — OpenAI-compatible chat completions
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  }
  if (temperature !== undefined) body.temperature = temperature
  if (maxTokens !== undefined) body.max_tokens = maxTokens
  return body
}

// ─── SSE chunk parser ───────────────────────────────────────

/**
 * Extract the text delta from a single parsed `data: {...}` SSE payload.
 * Returns an empty string if the chunk has no textual delta (e.g., role-only
 * frames, ping events, end-of-stream markers).
 */
export function extractDelta(provider: AiProvider, parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return ''
  const obj = parsed as Record<string, unknown>

  if (provider === 'anthropic') {
    // Anthropic: { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } }
    if (obj.type === 'content_block_delta') {
      const delta = obj.delta as Record<string, unknown> | undefined
      if (delta && typeof delta.text === 'string') return delta.text
    }
    return ''
  }

  // OpenAI-compatible: { choices: [{ delta: { content: '...' } }] }
  const choices = obj.choices as Array<Record<string, unknown>> | undefined
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0]
    const delta = choice.delta as Record<string, unknown> | undefined
    if (delta && typeof delta.content === 'string') return delta.content
    // Some providers send `text` instead of `delta.content` when stream=false
    if (typeof choice.text === 'string') return choice.text
  }
  return ''
}

// ─── Streaming driver ───────────────────────────────────────

const DONE_TOKEN = '[DONE]'

/**
 * Stream a chat completion, yielding text deltas as they arrive.
 *
 * Caller is responsible for accumulating the deltas; this generator only emits
 * deltas, not the running total.
 */
export async function* streamChatCompletion(
  options: AiStreamOptions,
): AsyncGenerator<AiStreamChunk, void, void> {
  const { provider, url, apiKey, model, messages, temperature, maxTokens, signal } = options

  if (!apiKey || !apiKey.trim()) {
    throw new Error('API key is required')
  }

  const endpoint = resolveProviderUrl(provider, url)
  const headers = buildHeaders(provider, apiKey)
  const body = buildBody({ provider, model, messages, temperature, maxTokens })

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok || !response.body) {
    let errText = `HTTP ${response.status} ${response.statusText}`
    try {
      const text = await response.text()
      if (text) errText += `\n${text.slice(0, 500)}`
    } catch {
      /* ignore */
    }
    throw new Error(errText)
  }

  // Read the stream, splitting on SSE event boundaries (\n\n).
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sepIdx = buffer.indexOf('\n\n')
      while (sepIdx !== -1) {
        const rawEvent = buffer.slice(0, sepIdx)
        buffer = buffer.slice(sepIdx + 2)
        sepIdx = buffer.indexOf('\n\n')

        // Each event is one or more lines; we only care about `data: ...`
        const dataLines: string[] = []
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }
        if (dataLines.length === 0) continue
        const dataText = dataLines.join('\n').trim()
        if (!dataText) continue
        if (dataText === DONE_TOKEN) return

        let parsed: unknown
        try {
          parsed = JSON.parse(dataText)
        } catch {
          // Anthropic sometimes sends non-JSON `event:` lines we already filtered;
          // skip anything that isn't valid JSON.
          continue
        }

        const delta = extractDelta(provider, parsed)
        if (delta) yield { delta }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}
