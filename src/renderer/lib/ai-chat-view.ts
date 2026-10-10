/**
 * Pure view helpers of the AI Chat editor (no React): scroll pinning, the
 * metrics hover text (issue #198) and the saved-MCP-request picker (#180).
 */
import type { AiCallMetrics, AiTurnMetrics } from '../../shared/ai-chat-types'
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
