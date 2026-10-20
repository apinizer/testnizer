/**
 * The main process rejects a bad SSE stream setting with an English sentence
 * (`validateStreamConfig`, `src/shared/mock-stream.ts`). The editor shows it
 * in the active locale: each known sentence maps to an i18n key (with its
 * `{name}` / `{max}` filled in); any other message passes through unchanged.
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
