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
 *     own `{choices: [], usage}` chunk, IN ADDITION to step 4 — the same
 *     numbers twice. Testnizer (`ai-chat.engine.ts` keeps the last `usage`
 *     object) and most clients read the LAST usage they see, so they count
 *     it once; a client that SUMS usage across chunks would double count
 *     against this mock (real OpenAI sends usage only on the `choices: []`
 *     chunk). Said in the editor's LLM hint (`mockLlm.bodyHint`) too;
 *  6. `data: [DONE]`.
 *
 * `finish_reason` is the plan's reason in OpenAI's words
 * (`LLM_WIRE_STOP_REASON`: `stop` / `length` / `tool_calls` /
 * `content_filter`). Events are tagged for the mid-stream error cut
 * (`LlmEvent`): text and argument pieces are `content`, steps 4–6 `finish`.
 */
import { LLM_WIRE_STOP_REASON } from '../../../shared/mock-stream'
import type { LlmEvent, LlmPlan } from './llm'
import { argumentPieces, chunkText } from './chunking'

const finishReason = (plan: LlmPlan): string => LLM_WIRE_STOP_REASON.openai[plan.stopReason]

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
    choices: [{ index: 0, message, logprobs: null, finish_reason: finishReason(plan) }],
    usage: usageOf(plan),
  }
}

export function openAiEvents(plan: LlmPlan): LlmEvent[] {
  const base = {
    id: plan.id,
    object: 'chat.completion.chunk',
    created: plan.created,
    model: plan.model,
  }
  const chunk = (delta: Record<string, unknown>): LlmEvent => ({
    data: JSON.stringify({
      ...base,
      choices: [{ index: 0, delta, logprobs: null, finish_reason: null }],
    }),
  })
  const events: LlmEvent[] = [chunk({ role: 'assistant', content: '' })]
  for (const piece of chunkText(plan.text, plan.chunking, plan.chunkSize)) {
    events.push({ ...chunk({ content: piece }), content: true, text: piece })
  }
  plan.toolCalls.forEach((c, index) => {
    events.push(
      chunk({
        tool_calls: [
          { index, id: c.id, type: 'function', function: { name: c.name, arguments: '' } },
        ],
      }),
    )
    for (const piece of argumentPieces(c.arguments)) {
      events.push({
        ...chunk({ tool_calls: [{ index, function: { arguments: piece } }] }),
        content: true,
      })
    }
  })
  const usage = usageOf(plan)
  events.push({
    data: JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: finishReason(plan) }],
      usage,
    }),
    finish: true,
  })
  if (plan.includeUsage) {
    events.push({ data: JSON.stringify({ ...base, choices: [], usage }), finish: true })
  }
  events.push({ data: '[DONE]', finish: true })
  return events
}
