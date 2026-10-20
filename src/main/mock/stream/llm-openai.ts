/**
 * OpenAI chat-completions wire shape of an AI mock reply (issue #221):
 * the `chat.completion` JSON and the `chat.completion.chunk` stream.
 *
 * Stream (design §6.3.4, Ek D §D.3.5):
 *  1. `delta: {role: 'assistant', content: ''}`;
 *  2. one chunk per text piece, `delta: {content}`;
 *  3. per tool call: one chunk opening it — `{index, id, type: 'function',
 *     function: {name, arguments: ''}}` — then its arguments in pieces
 *     (`{index, function: {arguments}}` only);
 *  4. the finish chunk: `delta: {}`, `finish_reason`, and `usage` ALWAYS —
 *     clients that never ask for usage (AI Chat's `custom` provider) still
 *     get the numbers (Testnizer's parser reads usage from any chunk);
 *  5. only when the request asked `stream_options.include_usage`: OpenAI's
 *     own `{choices: [], usage}` chunk;
 *  6. `data: [DONE]`.
 */
import type { SseEvent } from './sse-writer'
import type { LlmPlan } from './llm'
import { argumentPieces, chunkText } from './chunking'

function usageOf(plan: LlmPlan): Record<string, number> {
  const { inputTokens, outputTokens } = plan.usage
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  }
}

export function openAiCompletion(plan: LlmPlan): Record<string, unknown> {
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: plan.text === '' && plan.toolCalls.length > 0 ? null : plan.text,
  }
  if (plan.toolCalls.length > 0) {
    message.tool_calls = plan.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.arguments },
    }))
  }
  return {
    id: plan.id,
    object: 'chat.completion',
    created: plan.created,
    model: plan.model,
    choices: [{ index: 0, message, logprobs: null, finish_reason: plan.stopReason }],
    usage: usageOf(plan),
  }
}

export function openAiEvents(plan: LlmPlan): SseEvent[] {
  const base = {
    id: plan.id,
    object: 'chat.completion.chunk',
    created: plan.created,
    model: plan.model,
  }
  const chunk = (delta: Record<string, unknown>): SseEvent => ({
    data: JSON.stringify({
      ...base,
      choices: [{ index: 0, delta, logprobs: null, finish_reason: null }],
    }),
  })
  const events: SseEvent[] = [chunk({ role: 'assistant', content: '' })]
  for (const piece of chunkText(plan.text, plan.chunking)) events.push(chunk({ content: piece }))
  plan.toolCalls.forEach((c, index) => {
    events.push(
      chunk({
        tool_calls: [
          { index, id: c.id, type: 'function', function: { name: c.name, arguments: '' } },
        ],
      }),
    )
    for (const piece of argumentPieces(c.arguments)) {
      events.push(chunk({ tool_calls: [{ index, function: { arguments: piece } }] }))
    }
  })
  const usage = usageOf(plan)
  events.push({
    data: JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: plan.stopReason }],
      usage,
    }),
  })
  if (plan.includeUsage) events.push({ data: JSON.stringify({ ...base, choices: [], usage }) })
  events.push({ data: '[DONE]' })
  return events
}
