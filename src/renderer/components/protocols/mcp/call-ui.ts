/**
 * Small pure helpers for the MCP call UI (issues #164, #165). No React.
 */
import { asCallToolResult } from './mcp-content'
import { shortcutLabel } from '../../../lib/command-registry'
import type { ContentProblemReason } from '../../../lib/mcp-elicitation'

const pretty = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : (JSON.stringify(v, null, 2) ?? String(v))
  } catch {
    return String(v)
  }
}

/**
 * What Copy puts on the clipboard for a `tools/call` result: the text when
 * the result is only text blocks (what a user wants to paste), else the
 * pretty JSON of the whole result.
 */
export function toolResultCopyText(result: unknown): string {
  const parsed = asCallToolResult(result)
  if (
    parsed &&
    parsed.content.length > 0 &&
    parsed.structuredContent === undefined &&
    parsed.content.every((b) => b.type === 'text')
  ) {
    return parsed.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
  }
  return pretty(result)
}

/** `resources/read`: a single text content as text, anything else as pretty JSON. */
export function resourceCopyText(
  content: { contents: Array<{ text?: string; blob?: string }> } | null,
): string {
  if (!content) return ''
  const only = content.contents.length === 1 ? content.contents[0] : undefined
  if (only && typeof only.text === 'string') return only.text
  return pretty(content)
}

export const prettyJson = pretty

/** "Invoke (Cmd+Enter)" — the run button's tooltip names the chord (issue #165). */
export function withChord(label: string): string {
  return `${label} (${shortcutLabel('Enter')})`
}

/** i18n keys of the input / argument problems (shared by both forms). */
export const PROBLEM_KEYS: Record<ContentProblemReason, string> = {
  required: 'mcp.input.problemRequired',
  number: 'mcp.input.problemNumber',
  integer: 'mcp.input.problemInteger',
  minimum: 'mcp.input.problemMinimum',
  maximum: 'mcp.input.problemMaximum',
  minLength: 'mcp.input.problemMinLength',
  maxLength: 'mcp.input.problemMaxLength',
}
