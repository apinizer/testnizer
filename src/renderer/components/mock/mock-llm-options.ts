/**
 * Select options of the LLM row (`MockLlmOptions.tsx`, issue #222): value →
 * i18n key, literal for the key-coverage test. A plain module, so the
 * component files export components only (fast refresh).
 */
import type {
  MockLlmChunking,
  MockLlmProvider,
  MockLlmStopReason,
} from '../../../shared/mock-stream'

export const LLM_CHUNKING_OPTIONS: readonly (readonly [MockLlmChunking, string])[] = [
  ['word', 'mockLlm.chunkWord'],
  ['char', 'mockLlm.chunkChar'],
  ['sentence', 'mockLlm.chunkSentence'],
  ['fixed', 'mockLlm.chunkFixed'],
  ['whole', 'mockLlm.chunkWhole'],
]

/** Each provider's stop reasons, labelled with its own wire value (`LLM_PROVIDER_STOP_REASONS`). */
export const LLM_STOP_REASON_OPTIONS: Record<
  MockLlmProvider,
  readonly (readonly [MockLlmStopReason, string])[]
> = {
  openai: [
    ['stop', 'mockLlm.stopOpenai.stop'],
    ['length', 'mockLlm.stopOpenai.length'],
    ['content_filter', 'mockLlm.stopOpenai.contentFilter'],
    ['tool_calls', 'mockLlm.stopOpenai.toolCalls'],
  ],
  anthropic: [
    ['stop', 'mockLlm.stopAnthropic.endTurn'],
    ['length', 'mockLlm.stopAnthropic.maxTokens'],
    ['stop_sequence', 'mockLlm.stopAnthropic.stopSequence'],
    ['content_filter', 'mockLlm.stopAnthropic.refusal'],
    ['tool_calls', 'mockLlm.stopAnthropic.toolUse'],
  ],
}
