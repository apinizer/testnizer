/**
 * Pure reducers and helpers over the AI Chat turn model (`ai-chat-types.ts`).
 * The renderer folds stream events into the live turn with these; main uses
 * the same ones to build the turn it reports, the repo to cap what it stores.
 */
import {
  AI_TOOL_RESULT_MAX_CHARS,
  type AiAssistantPart,
  type AiAssistantTurn,
  type AiCallMetrics,
  type AiNoticeKind,
  type AiNoticePart,
  type AiToolCallStatus,
  type AiTurn,
  type AiTurnMetrics,
} from './ai-chat-types'

/** Text cut at `max` chars, with a flag when it was cut. */
export function capText(
  text: string,
  max: number = AI_TOOL_RESULT_MAX_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: `${text.slice(0, max)}\n…[truncated at ${max} characters]`, truncated: true }
}

/** The assistant turn's text parts, joined. */
export function textOfParts(parts: readonly AiAssistantPart[]): string {
  return parts
    .filter((p): p is Extract<AiAssistantPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

/** Append streamed text: extends the last part when it is text, else opens a new text part. */
export function applyTextDelta(turn: AiAssistantTurn, delta: string): AiAssistantTurn {
  if (!delta) return turn
  const parts = [...(turn.parts ?? [])]
  const last = parts[parts.length - 1]
  if (last && last.type === 'text') parts[parts.length - 1] = { ...last, text: last.text + delta }
  else parts.push({ type: 'text', text: delta })
  return { ...turn, parts, content: turn.content + delta }
}

function sameSlot(a: AiAssistantPart, b: AiAssistantPart): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'tool_call' && b.type === 'tool_call') return a.id === b.id
  if (a.type === 'tool_result' && b.type === 'tool_result') return a.callId === b.callId
  if (a.type === 'notice' && b.type === 'notice') return a.id === b.id
  return false
}

/** Add a non-text part, or replace the one with the same identity (status updates). */
export function upsertPart(turn: AiAssistantTurn, part: AiAssistantPart): AiAssistantTurn {
  const parts = [...(turn.parts ?? [])]
  const idx = parts.findIndex((p) => sameSlot(p, part))
  if (idx >= 0) parts[idx] = part
  else parts.push(part)
  return { ...turn, parts }
}

/** Totals over a turn's calls. Token totals only when EVERY call reported usage. */
export function sumTurnMetrics(calls: readonly AiCallMetrics[]): AiTurnMetrics {
  // Issue #198: the totals are the sum of the calls that reported usage; a
  // call that did not report makes them "partial", not "not reported".
  const reporting = calls.filter((c) => c.usageReported)
  const usageReported = reporting.length > 0
  const usagePartial = usageReported && reporting.length < calls.length
  const sum = (pick: (c: AiCallMetrics) => number | undefined): number | undefined => {
    let any = false
    let total = 0
    for (const c of reporting) {
      const v = pick(c)
      if (typeof v === 'number') {
        any = true
        total += v
      }
    }
    return any ? total : undefined
  }
  const inputTokens = sum((c) => c.inputTokens)
  const outputTokens = sum((c) => c.outputTokens)
  const out: AiTurnMetrics = {
    calls: [...calls],
    status: calls.length > 0 ? calls[calls.length - 1].status : null,
    ttfbMs: calls.length > 0 ? calls[0].ttfbMs : null,
    durationMs: calls.reduce((n, c) => n + c.durationMs, 0),
    usageReported,
  }
  if (usagePartial) out.usagePartial = true
  if (inputTokens !== undefined) out.inputTokens = inputTokens
  if (outputTokens !== undefined) out.outputTokens = outputTokens
  if (inputTokens !== undefined || outputTokens !== undefined) {
    out.totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0)
  }
  const cached = sum((c) => c.cachedTokens)
  if (cached !== undefined) out.cachedTokens = cached
  const reasoning = sum((c) => c.reasoningTokens)
  if (reasoning !== undefined) out.reasoningTokens = reasoning
  return out
}

/**
 * Earlier turns as the provider sees them on the next prompt: TEXT ONLY.
 * Tool calls / results of earlier prompts are not replayed — the server set
 * may have changed since (an orphaned tool_use without its tool definition or
 * result is a 400 on Anthropic), and a provider switch mid-conversation would
 * hand one provider the other's ids. Empty assistant turns (cancelled before
 * any text) are skipped: Anthropic rejects empty assistant content.
 */
export function historyAsText(
  turns: readonly AiTurn[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const t of turns) {
    if (t.role === 'user') {
      if (t.content.trim()) out.push({ role: 'user', content: t.content })
      continue
    }
    const text = t.parts ? textOfParts(t.parts) : t.content
    if (text.trim()) out.push({ role: 'assistant', content: text })
  }
  return out
}

// ─── Stored-turn sanitising (repo write path) ───────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const TOOL_STATUSES = new Set([
  'pending-approval',
  'approved',
  'denied',
  'running',
  'done',
  'error',
])
const NOTICE_KINDS = new Set(['loop-cap', 'server-error', 'stdio-untrusted'])

function sanitizeCall(raw: unknown): AiCallMetrics | null {
  if (!isObj(raw)) return null
  const m: AiCallMetrics = {
    status: num(raw.status) ?? null,
    ttfbMs: num(raw.ttfbMs) ?? null,
    durationMs: num(raw.durationMs) ?? 0,
    usageReported: raw.usageReported === true,
  }
  for (const k of ['inputTokens', 'outputTokens', 'cachedTokens', 'reasoningTokens'] as const) {
    const v = num(raw[k])
    if (v !== undefined) m[k] = v
  }
  if (typeof raw.error === 'string') m.error = raw.error.slice(0, 2_000)
  return m
}

function sanitizePart(raw: unknown): AiAssistantPart | null {
  if (!isObj(raw)) return null
  switch (raw.type) {
    case 'text':
      return { type: 'text', text: str(raw.text) }
    case 'tool_call': {
      const rawStatus = TOOL_STATUSES.has(str(raw.status))
        ? (str(raw.status) as AiToolCallStatus)
        : 'error'
      // A turn is stored once it ended — nothing is still waiting.
      const status: AiToolCallStatus =
        rawStatus === 'pending-approval' || rawStatus === 'running' ? 'error' : rawStatus
      return {
        type: 'tool_call',
        id: str(raw.id),
        serverId: str(raw.serverId),
        server: str(raw.server),
        tool: str(raw.tool),
        argsJson: capText(str(raw.argsJson)).text,
        status,
      }
    }
    case 'tool_result': {
      const capped = capText(str(raw.content))
      return {
        type: 'tool_result',
        callId: str(raw.callId),
        content: capped.text,
        isError: raw.isError === true,
        ...(capped.truncated || raw.truncated === true ? { truncated: true } : {}),
      }
    }
    case 'notice': {
      if (!NOTICE_KINDS.has(str(raw.kind))) return null
      const p: AiNoticePart = {
        type: 'notice',
        id: str(raw.id),
        kind: str(raw.kind) as AiNoticeKind,
      }
      if (typeof raw.serverId === 'string') p.serverId = raw.serverId
      if (typeof raw.server === 'string') p.server = raw.server
      if (typeof raw.message === 'string') p.message = raw.message.slice(0, 2_000)
      if (typeof raw.commandLine === 'string') p.commandLine = raw.commandLine.slice(0, 4_000)
      if (Array.isArray(raw.envNames)) {
        p.envNames = raw.envNames.filter((n): n is string => typeof n === 'string')
      }
      if (Array.isArray(raw.env)) {
        p.env = raw.env.filter(isObj).map((e) => ({
          name: str(e.name).slice(0, 256),
          value: str(e.value).slice(0, 16_000),
          ...(e.masked === true ? { masked: true } : {}),
          ...(e.dangerous === true ? { dangerous: true } : {}),
        }))
      }
      if (raw.status === 'pending' || raw.status === 'trusted' || raw.status === 'skipped') {
        p.status = raw.status === 'pending' ? 'skipped' : raw.status
      }
      return p
    }
    default:
      return null
  }
}

/**
 * Turns as the repo stores them: unknown shapes dropped, tool results and
 * arguments capped (main enforces the cap — never trusts the renderer), and
 * nothing left "waiting" (a stored turn has ended).
 */
export function sanitizeTurns(raw: unknown): AiTurn[] {
  if (!Array.isArray(raw)) return []
  const out: AiTurn[] = []
  for (const t of raw) {
    if (!isObj(t)) continue
    const id = str(t.id)
    const timestamp = num(t.timestamp) ?? Date.now()
    if (t.role === 'user') {
      const content = str(t.content)
      const template = typeof t.template === 'string' ? t.template : undefined
      out.push({
        id,
        role: 'user',
        content,
        ...(template !== undefined && template !== content ? { template } : {}),
        timestamp,
      })
      continue
    }
    if (t.role !== 'assistant') continue
    const parts = Array.isArray(t.parts)
      ? t.parts.map(sanitizePart).filter((p): p is AiAssistantPart => p !== null)
      : undefined
    const turn: AiAssistantTurn = {
      id,
      role: 'assistant',
      content: parts ? textOfParts(parts) || str(t.content) : str(t.content),
      timestamp,
    }
    if (parts && parts.length > 0) turn.parts = parts
    if (t.truncated === true) turn.truncated = true
    if (typeof t.error === 'string') turn.error = t.error.slice(0, 4_000)
    if (isObj(t.metrics) && Array.isArray(t.metrics.calls)) {
      const calls = t.metrics.calls.map(sanitizeCall).filter((c): c is AiCallMetrics => c !== null)
      turn.metrics = sumTurnMetrics(calls)
    }
    out.push(turn)
  }
  return out
}
