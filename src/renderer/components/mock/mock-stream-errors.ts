/**
 * The main process rejects a bad SSE stream setting or AI (`llm`) reply
 * setting with an English sentence (`validateStreamConfig` /
 * `validateLlmConfig`, `src/shared/mock-stream.ts`). The editor shows it in
 * the active locale: each known sentence maps to an i18n key (with its
 * `{name}` / `{max}` / `{n}` filled in); any other message passes through
 * unchanged. Every rule is anchored at both ends — "…must be a JSON object"
 * is a prefix of "…must be a JSON object or JSON text".
 */
import { t } from '../../lib/i18n'

const RULES: { re: RegExp; key: string; vars?: string[] }[] = [
  { re: /^Stream settings must be an object$/, key: 'mockSse.err.object' },
  { re: /^Unknown stream setting: (.+)$/, key: 'mockSse.err.unknown', vars: ['name'] },
  {
    re: /^Event interval must be a whole number of milliseconds between 0 and (\d+)$/,
    key: 'mockSse.err.interval',
    vars: ['max'],
  },
  {
    re: /^Heartbeat interval must be a whole number of milliseconds between 0 and (\d+)$/,
    key: 'mockSse.err.heartbeat',
    vars: ['max'],
  },
  { re: /^Loop must be true or false$/, key: 'mockSse.err.loop' },
  { re: /^Resume must be true or false$/, key: 'mockSse.err.resume' },
  {
    re: /^When the events run out, the stream must either close or stay open/,
    key: 'mockSse.err.onEnd',
  },
  // ── AI replies (`llm`) ──
  { re: /^LLM settings must be an object$/, key: 'mockLlm.err.object' },
  { re: /^Unknown LLM setting: (.+)$/, key: 'mockLlm.err.unknown', vars: ['name'] },
  { re: /^Provider must be "openai" or "anthropic"$/, key: 'mockLlm.err.provider' },
  { re: /^Chunking must be "word", "char" or "sentence"$/, key: 'mockLlm.err.chunking' },
  {
    re: /^Chunk interval must be a whole number of milliseconds between 0 and (\d+)$/,
    key: 'mockLlm.err.interval',
    vars: ['max'],
  },
  { re: /^Stop reason must be "stop", "length" or "tool_calls"$/, key: 'mockLlm.err.stopReason' },
  { re: /^Tool calls must be a list$/, key: 'mockLlm.err.toolCallsList' },
  { re: /^At most (\d+) tool calls per reply$/, key: 'mockLlm.err.toolCallsMax', vars: ['max'] },
  {
    re: /^Tool call (\d+) must be an object with a name and arguments$/,
    key: 'mockLlm.err.toolCallObject',
    vars: ['n'],
  },
  {
    re: /^Tool call (\d+): unknown field (.+)$/,
    key: 'mockLlm.err.toolCallField',
    vars: ['n', 'name'],
  },
  { re: /^Tool call (\d+) needs a name$/, key: 'mockLlm.err.toolCallName', vars: ['n'] },
  {
    re: /^Tool call (\d+): the id must be non-empty text \(or left out to generate one\)$/,
    key: 'mockLlm.err.toolCallId',
    vars: ['n'],
  },
  {
    re: /^Tool call (\d+): arguments must be a JSON object or JSON text$/,
    key: 'mockLlm.err.argsType',
    vars: ['n'],
  },
  {
    re: /^Tool call (\d+): arguments are longer than (\d+) characters$/,
    key: 'mockLlm.err.argsLength',
    vars: ['n', 'max'],
  },
  {
    re: /^Tool call (\d+): arguments are not valid JSON$/,
    key: 'mockLlm.err.argsJson',
    vars: ['n'],
  },
  {
    re: /^Tool call (\d+): arguments must be a JSON object$/,
    key: 'mockLlm.err.argsObject',
    vars: ['n'],
  },
  {
    re: /^Stop reason "tool_calls" needs at least one tool call$/,
    key: 'mockLlm.err.toolCallsNeeded',
  },
  { re: /^Usage must be "auto" or \{ inputTokens, outputTokens \}$/, key: 'mockLlm.err.usage' },
  { re: /^Unknown usage field: (.+)$/, key: 'mockLlm.err.usageField', vars: ['name'] },
  {
    re: /^Usage (inputTokens|outputTokens) must be a whole number between 0 and (\d+)$/,
    key: 'mockLlm.err.usageCount',
    vars: ['name', 'max'],
  },
]

export function translateStreamError(message: string): string {
  for (const rule of RULES) {
    const m = rule.re.exec(message)
    if (!m) continue
    let text = t(rule.key)
    rule.vars?.forEach((v, i) => {
      text = text.replace(`{${v}}`, m[i + 1])
    })
    return text
  }
  return message
}
