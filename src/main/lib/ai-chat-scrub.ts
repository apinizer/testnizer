/**
 * AI Chat's use of the ONE main-side mask (`sensitive-scrub.ts`, issues #195,
 * #196): what AI Chat hands the renderer as an error and what it stores in a
 * conversation (issue #199) goes through the same two layers every History /
 * Console path uses — credential NAMES (`"api_key": "…"`, `?token=…`) and
 * secret VALUES (secret-flagged variables of every project, plus the
 * credentials this request itself carried: the provider key and the
 * credential-named custom headers).
 *
 * Also the per-conversation size cap (issue #199): a conversation is stored
 * as one JSON column, so it is kept under `AI_CONVERSATION_MAX_BYTES` —
 * oldest tool results are cut first, with a visible note in their place.
 */
import { getDb } from '../db/database'
import {
  collectCredentialValues,
  maskBodyText,
  maskUrlText,
  scrubberFor,
  type Scrubber,
} from './sensitive-scrub'
import type {
  AiAssistantPart,
  AiAssistantTurn,
  AiCallMetrics,
  AiTurn,
  AiTurnMetrics,
} from '../../shared/ai-chat-types'

/** The DB handle, or null before init / in tests without one (name rule only then). */
function dbOrNull(): ReturnType<typeof getDb> | null {
  try {
    return getDb()
  } catch {
    return null
  }
}

/** The request's own credentials, as the value scrub needs them. */
export interface AiCredentialSource {
  apiKey?: unknown
  headers?: unknown
  url?: unknown
}

/** A scrubber over the secret variables plus the credentials `source` carried. */
export function aiScrubberFor(source: AiCredentialSource = {}): Scrubber {
  const extra: unknown[] = []
  if (typeof source.apiKey === 'string') extra.push(source.apiKey)
  extra.push(...collectCredentialValues({ headers: source.headers, url: source.url }))
  return scrubberFor(dbOrNull(), extra)
}

/** Free text (an error, a prompt, an answer): credential query values + JSON fields + values. */
export function scrubAiText(text: string, scrub: Scrubber): string {
  if (!text) return text
  return maskUrlText(maskBodyText(text, scrub), scrub)
}

function scrubCall(m: AiCallMetrics, scrub: Scrubber): AiCallMetrics {
  return m.error ? { ...m, error: scrubAiText(m.error, scrub) } : m
}

/** Per-call / per-turn metrics with their error texts scrubbed. */
export function scrubCallMetrics(m: AiCallMetrics, scrub: Scrubber): AiCallMetrics {
  return scrubCall(m, scrub)
}

export function scrubTurnMetrics(
  m: AiTurnMetrics | undefined,
  scrub: Scrubber,
): AiTurnMetrics | undefined {
  if (!m) return m
  return { ...m, calls: m.calls.map((c) => scrubCall(c, scrub)) }
}

function scrubPart(p: AiAssistantPart, scrub: Scrubber): AiAssistantPart {
  switch (p.type) {
    case 'text':
      return { ...p, text: scrubAiText(p.text, scrub) }
    case 'tool_call':
      return { ...p, argsJson: maskBodyText(p.argsJson, scrub) }
    case 'tool_result':
      return { ...p, content: scrubAiText(p.content, scrub) }
    case 'notice': {
      const out = { ...p }
      if (out.message) out.message = scrubAiText(out.message, scrub)
      if (out.commandLine) out.commandLine = scrub.text(out.commandLine)
      if (out.env) {
        out.env = out.env.map((e) => ({ ...e, value: e.masked ? e.value : scrub.text(e.value) }))
      }
      return out
    }
  }
}

/**
 * Turns as a conversation stores them (issue #199): the user's prompt (the
 * RESOLVED one — a `{{secretVar}}` value is in it), the answer text, tool
 * arguments and results, notices and errors, all scrubbed.
 */
export function scrubTurnsForStorage(turns: readonly AiTurn[], scrub: Scrubber): AiTurn[] {
  return turns.map((t): AiTurn => {
    if (t.role === 'user') {
      const user = { ...t, content: scrubAiText(t.content, scrub) }
      if (t.template !== undefined) user.template = scrubAiText(t.template, scrub)
      return user
    }
    const out: AiAssistantTurn = { ...t, content: scrubAiText(t.content, scrub) }
    if (t.parts) out.parts = t.parts.map((p) => scrubPart(p, scrub))
    if (t.error) out.error = scrubAiText(t.error, scrub)
    if (t.metrics) out.metrics = scrubTurnMetrics(t.metrics, scrub)
    return out
  })
}

// ─── Size cap ────────────────────────────────────────────────────

/** Largest stored conversation (the `messages_json` text, UTF-8 bytes). */
export const AI_CONVERSATION_MAX_BYTES = 2 * 1024 * 1024

/**
 * Where a trim brings a conversation (75 % of the cap): the next answers fit
 * again and are appended in place, instead of every answer past the cap
 * re-parsing and rewriting the whole conversation.
 */
export const AI_CONVERSATION_TRIM_TO_BYTES = Math.floor(AI_CONVERSATION_MAX_BYTES * 0.75)

/** What an older tool result / argument / text is replaced with when the cap is hit. */
export const AI_CONVERSATION_TRIMMED_NOTE =
  '[Removed to keep this conversation under the 2 MB storage limit]'

const bytesOf = (turns: readonly AiTurn[]): number =>
  Buffer.byteLength(JSON.stringify(turns), 'utf-8')

/** Text kept from an older prompt / answer cut by the cap. */
const TEXT_KEEP_CHARS = 2_000

/**
 * Keep a conversation under `maxBytes`, oldest first, in this order: tool
 * results → tool-call arguments → long prompt / answer texts (cut, with the
 * note) → whole oldest turns. The newest turn pair is never dropped.
 */
export function capConversation(
  turns: readonly AiTurn[],
  maxBytes: number = AI_CONVERSATION_MAX_BYTES,
): { turns: AiTurn[]; trimmed: boolean } {
  let out: AiTurn[] = [...turns]
  let size = bytesOf(out)
  if (size <= maxBytes) return { turns: out, trimmed: false }
  const note = AI_CONVERSATION_TRIMMED_NOTE

  const passes: Array<(p: AiAssistantPart) => AiAssistantPart | null> = [
    (p) =>
      p.type === 'tool_result' && p.content !== note
        ? { ...p, content: note, truncated: true }
        : null,
    (p) => (p.type === 'tool_call' && p.argsJson !== note ? { ...p, argsJson: note } : null),
    (p) =>
      p.type === 'text' && p.text.length > TEXT_KEEP_CHARS
        ? { ...p, text: `${p.text.slice(0, TEXT_KEEP_CHARS)}\n${note}` }
        : null,
  ]
  for (const pass of passes) {
    for (let i = 0; i < out.length && size > maxBytes; i++) {
      const t = out[i]
      if (t.role !== 'assistant' || !t.parts) continue
      let changed = false
      const parts = t.parts.map((p) => {
        if (size <= maxBytes) return p
        const next = pass(p)
        if (!next) return p
        changed = true
        return next
      })
      if (!changed) continue
      const content = parts
        .filter((p): p is Extract<AiAssistantPart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('')
      out[i] = { ...t, parts, content: content || t.content }
      size = bytesOf(out)
    }
    if (size <= maxBytes) return { turns: out, trimmed: true }
  }
  // Long prompts and part-less answers (older rows) — cut their text.
  for (let i = 0; i < out.length && size > maxBytes; i++) {
    const t = out[i]
    // An answer with parts is read back from its parts (cut above).
    if (t.role === 'assistant' && t.parts) continue
    if (t.content.length <= TEXT_KEEP_CHARS) continue
    out[i] = { ...t, content: `${t.content.slice(0, TEXT_KEEP_CHARS)}\n${note}` } as AiTurn
    size = bytesOf(out)
  }
  // Still over: drop the oldest turns, never the newest pair.
  while (size > maxBytes && out.length > 2) {
    out = out.slice(1)
    size = bytesOf(out)
  }
  return { turns: out, trimmed: true }
}
