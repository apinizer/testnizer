/**
 * The issue #222 parts of the LLM row (`MockLlmOptions.tsx`), split out like
 * `MockLlmToolCalls` / `MockLlmStreamError`: the two fields that only show
 * for one setting — `fixed` chunking's size and Anthropic `stop_sequence`'s
 * sequence. Built from the row's field parts and written through the row's
 * `write`. The select options live in `mock-llm-options.ts`.
 */
import { useTranslation } from '../../lib/i18n'
import { useNumberDraft } from '../../lib/number-draft'
import {
  LLM_DEFAULT_CHUNK_SIZE,
  LLM_DEFAULT_STOP_SEQUENCE,
  LLM_MAX_CHUNK_CHARS,
  LLM_MAX_STOP_SEQUENCE_CHARS,
  type MockLlmConfig,
} from '../../../shared/mock-stream'
import type { ConfigPatch } from './use-config-writer'
import { OptionNumber, OptionText } from './MockOptionFields'

type Write = (patch: ConfigPatch<MockLlmConfig>) => Promise<void>

/** "Chunk size (characters)" — the row shows it while chunking is `fixed`. */
export function LlmChunkSizeField({ cfg, write }: { cfg: MockLlmConfig; write: Write }) {
  const { t } = useTranslation()
  const draft = useNumberDraft({
    value: cfg.chunkSize ?? LLM_DEFAULT_CHUNK_SIZE,
    min: 1,
    max: LLM_MAX_CHUNK_CHARS,
    onChange: (v) => void write({ chunkSize: v }),
  })
  return <OptionNumber label={t('mockLlm.chunkSize')} testId="mock-llm-chunk-size" draft={draft} />
}

/** "Stop sequence" — the row shows it for Anthropic `stop_sequence`. */
export function LlmStopSequenceField({ cfg, write }: { cfg: MockLlmConfig; write: Write }) {
  const { t } = useTranslation()
  return (
    <OptionText
      label={t('mockLlm.stopSequence')}
      testId="mock-llm-stop-sequence"
      value={cfg.stopSequence ?? ''}
      placeholder={LLM_DEFAULT_STOP_SEQUENCE}
      maxLength={LLM_MAX_STOP_SEQUENCE_CHARS}
      width="8rem"
      mono
      // Empty = the default sequence (the key is then left out).
      onCommit={(v) => void write({ stopSequence: v === '' ? undefined : v })}
    />
  )
}
