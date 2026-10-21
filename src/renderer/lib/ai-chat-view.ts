/**
 * Pure view helpers of the AI Chat editor (no React): scroll pinning, the
 * metrics hover text (issue #198) and the saved-MCP-request picker (#180).
 */
import type { AiCallMetrics, AiTurn, AiTurnMetrics } from '../../shared/ai-chat-types'
import type { TreeNode } from '../types'

/**
 * Slack a user gets before we consider them "scrolled away". A couple of
 * lines' worth: sub-pixel rounding on a zoomed window and trackpad inertia
 * both leave the view a few px short of the true bottom, and unpinning there
 * would strand the stream one line above the fold.
 */
export const SCROLL_PIN_THRESHOLD_PX = 40

/**
 * Whether the conversation view is close enough to the bottom that new
 * content should keep following it. Split out of the effect so the decision
 * is testable without a real scrolling layout (jsdom reports 0 for every
 * scroll metric).
 */
export function isPinnedToBottom(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  threshold: number = SCROLL_PIN_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
}

export const formatMs = (v: number | null | undefined): string =>
  v == null ? '—' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} s`

/**
 * Which calls the token totals cover when only some reported usage
 * (issue #198): "Partial — usage reported by calls #1, #3 of 3". Null when
 * the totals are complete or nothing was reported.
 */
export function partialUsageNote(m: AiTurnMetrics, t: (k: string) => string): string | null {
  if (!m.usagePartial) return null
  const which = m.calls.flatMap((c, i) => (c.usageReported ? [`#${i + 1}`] : []))
  return `${t('aiChat.metrics.partialHint')} ${which.join(', ')} ${t('aiChat.metrics.of')} ${m.calls.length}`
}

/** Hover text: the token breakdown and, for a tool loop, each LLM call. */
export function metricsTooltip(m: AiTurnMetrics, t: (k: string) => string): string {
  const lines: string[] = []
  const tok = (c: AiCallMetrics | AiTurnMetrics): string => {
    if (!c.usageReported) return t('aiChat.metrics.notReported')
    const parts = [
      `${t('aiChat.metrics.input')} ${c.inputTokens ?? '—'}`,
      `${t('aiChat.metrics.output')} ${c.outputTokens ?? '—'}`,
    ]
    if (c.cachedTokens !== undefined) parts.push(`${t('aiChat.metrics.cached')} ${c.cachedTokens}`)
    if (c.reasoningTokens !== undefined) {
      parts.push(`${t('aiChat.metrics.reasoning')} ${c.reasoningTokens}`)
    }
    return parts.join(' · ')
  }
  lines.push(tok(m))
  const partial = partialUsageNote(m, t)
  if (partial) lines.push(partial)
  if (m.calls.length > 1) {
    m.calls.forEach((c, i) => {
      lines.push(
        `#${i + 1}: ${c.status ?? '—'} · ${t('aiChat.metrics.ttfb')} ${formatMs(c.ttfbMs)} · ${formatMs(c.durationMs)} · ${tok(c)}`,
      )
    })
  }
  return lines.join('\n')
}

interface McpRequestRef {
  id: string
  kind: 'endpoint' | 'request'
  name: string
}

/** The project's saved MCP requests (APIs tree), for the server picker. */
export function mcpRequestsOf(tree: readonly TreeNode[]): McpRequestRef[] {
  const out: McpRequestRef[] = []
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const n of nodes) {
      if ((n.type === 'endpoint' || n.type === 'request') && n.protocol === 'mcp') {
        out.push({ id: n.id, kind: n.type, name: n.label })
      }
      if (n.children) walk(n.children)
    }
  }
  walk(tree)
  return out
}

/**
 * Issue #228 — the Settings + Tools area and the conversation share the editor
 * body through a drag divider (the MCP editor's split, #211), remembered per
 * user. The floors are pixels: the config side keeps both section headers, the
 * conversation keeps room for a whole approval card.
 */
export const AI_CHAT_SPLIT_ID = 'ai-chat-config-transcript'
export const AI_CONFIG_PANEL_ID = 'ai-chat-config-panel'
export const AI_TRANSCRIPT_PANEL_ID = 'ai-chat-transcript-panel'
export const AI_CONFIG_MIN_PX = 80
export const AI_TRANSCRIPT_MIN_PX = 220

/**
 * What the live turn is waiting on the user for — a tool call's approval or an
 * stdio server's trust — as a stable key (`call:<id>` / `trust:<id>`), or null.
 * A new key is the moment the card has to be brought into view.
 */
export function awaitingUserKey(
  messages: readonly AiTurn[],
  pendingResponseId: string | null | undefined,
): string | null {
  if (!pendingResponseId) return null
  const turn = messages.find((m) => m.id === pendingResponseId)
  if (!turn || turn.role !== 'assistant') return null
  for (const p of turn.parts ?? []) {
    if (p.type === 'tool_call' && p.status === 'pending-approval') return `call:${p.id}`
    if (
      p.type === 'notice' &&
      p.kind === 'stdio-untrusted' &&
      (p.status ?? 'pending') === 'pending'
    )
      return `trust:${p.id}`
  }
  return null
}

interface VerticalBox {
  top: number
  bottom: number
}

/**
 * The `scrollTop` that brings `target` fully inside `view` (both viewport
 * rects), moving as little as possible; a target taller than the view is
 * aligned to its bottom edge — an approval card ends with its buttons.
 */
export function scrollTopToReveal(
  view: VerticalBox,
  target: VerticalBox,
  scrollTop: number,
  margin = 8,
): number {
  const top = view.top + margin
  const bottom = view.bottom - margin
  if (target.bottom > bottom) return Math.max(0, scrollTop + (target.bottom - bottom))
  if (target.top < top) return Math.max(0, scrollTop - (top - target.top))
  return scrollTop
}
