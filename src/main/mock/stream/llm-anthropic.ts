/**
 * Anthropic messages wire shape of an AI mock reply (issue #221): the
 * `message` JSON and the named-event stream (platform.claude.com streaming
 * docs):
 *
 *   message_start (usage: input_tokens, output_tokens 1)
 *   content_block_start (text) → ping → content_block_delta text_delta … → content_block_stop
 *   per tool call: content_block_start (tool_use, input {}) →
 *                  content_block_delta input_json_delta … → content_block_stop
 *   message_delta (stop_reason, usage.output_tokens — cumulative) → message_stop
 *
 * `stop_reason` is the plan's reason in Anthropic's words
 * (`LLM_WIRE_STOP_REASON`: `end_turn` / `max_tokens` / `tool_use` /
 * `stop_sequence` / `refusal`); `stop_sequence` names the matched sequence
 * for a `stop_sequence` stop and is null otherwise (stop-reasons docs).
 * Events are tagged for the mid-stream error cut (`LlmEvent`): text and
 * `input_json_delta` pieces are `content`, `message_delta` / `message_stop`
 * `finish`.
 *
 * Block indices are contiguous from 0. The text block is left out when the
 * text is empty and the reply only calls tools; a reply with neither still
 * has one (empty) text block. Usage is always reported (Anthropic always
 * does).
 */
import { LLM_WIRE_STOP_REASON } from '../../../shared/mock-stream'
import type { LlmEvent, LlmPlan } from './llm'
import { argumentPieces, chunkText } from './chunking'

const stopReason = (plan: LlmPlan): string => LLM_WIRE_STOP_REASON.anthropic[plan.stopReason]

function hasTextBlock(plan: LlmPlan): boolean {
  return plan.text !== '' || plan.toolCalls.length === 0
}

export function anthropicMessage(plan: LlmPlan): Record<string, unknown> {
  const content: Record<string, unknown>[] = []
  if (hasTextBlock(plan)) content.push({ type: 'text', text: plan.text })
  for (const c of plan.toolCalls) {
    content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input })
  }
  return {
    id: plan.id,
    type: 'message',
    role: 'assistant',
    model: plan.model,
    content,
    stop_reason: stopReason(plan),
    stop_sequence: plan.stopSequence,
    usage: { input_tokens: plan.usage.inputTokens, output_tokens: plan.usage.outputTokens },
  }
}

export function anthropicEvents(plan: LlmPlan): LlmEvent[] {
  const ev = (type: string, body: Record<string, unknown> = {}): LlmEvent => ({
    event: type,
    data: JSON.stringify({ type, ...body }),
  })
  const events: LlmEvent[] = [
    ev('message_start', {
      message: {
        id: plan.id,
        type: 'message',
        role: 'assistant',
        model: plan.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: plan.usage.inputTokens, output_tokens: 1 },
      },
    }),
  ]
  let index = 0
  if (hasTextBlock(plan)) {
    events.push(ev('content_block_start', { index, content_block: { type: 'text', text: '' } }))
    events.push(ev('ping'))
    for (const piece of chunkText(plan.text, plan.chunking, plan.chunkSize)) {
      events.push({
        ...ev('content_block_delta', { index, delta: { type: 'text_delta', text: piece } }),
        content: true,
        text: piece,
      })
    }
    events.push(ev('content_block_stop', { index }))
    index++
  } else {
    events.push(ev('ping'))
  }
  for (const c of plan.toolCalls) {
    events.push(
      ev('content_block_start', {
        index,
        content_block: { type: 'tool_use', id: c.id, name: c.name, input: {} },
      }),
    )
    for (const piece of argumentPieces(c.arguments)) {
      events.push({
        ...ev('content_block_delta', {
          index,
          delta: { type: 'input_json_delta', partial_json: piece },
        }),
        content: true,
      })
    }
    events.push(ev('content_block_stop', { index }))
    index++
  }
  events.push({
    ...ev('message_delta', {
      delta: { stop_reason: stopReason(plan), stop_sequence: plan.stopSequence },
      usage: { output_tokens: plan.usage.outputTokens },
    }),
    finish: true,
  })
  events.push({ ...ev('message_stop'), finish: true })
  return events
}
