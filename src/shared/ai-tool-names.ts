/**
 * Tool names the LLM sees (issue #180). Every MCP tool is offered under a
 * name namespaced by its server, sanitized to the strictest rule of the
 * providers AI Chat talks to:
 *  - OpenAI / OpenAI-compatible: `^[a-zA-Z0-9_-]{1,64}$`;
 *  - Anthropic: `^[a-zA-Z0-9_-]{1,64}$`;
 *  - Gemini (OpenAI compatibility): must START with a letter or underscore,
 *    max 64 (letters, digits, `_ . : -`).
 * Intersection: a letter first, then `[a-zA-Z0-9_-]`, at most 64 chars.
 *
 * Names map back through the table built per Send — never by parsing the
 * name (a server called `a__b` would split wrongly, and two servers can share
 * a display name).
 */

export const AI_TOOL_NAME_MAX = 64
export const AI_TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

/** 32-bit FNV-1a → 6 base-36 chars: stable short suffix for overflow / collisions. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(6, '0').slice(-6)
}

/** Any text → `[a-zA-Z0-9_-]+` (runs of other chars become `_`), never empty. */
export function sanitizeNamePart(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s || 'x'
}

/** `slug__tool`, sanitized, letter first, ≤ 64 — hash-suffixed when it had to be cut. */
export function wireToolName(serverName: string, toolName: string): string {
  let name = `${sanitizeNamePart(serverName)}__${sanitizeNamePart(toolName)}`
  if (!/^[a-zA-Z]/.test(name)) name = `s${name}`
  if (name.length > AI_TOOL_NAME_MAX) {
    const suffix = `_${shortHash(`${serverName}\u0000${toolName}`)}`
    name = name.slice(0, AI_TOOL_NAME_MAX - suffix.length) + suffix
  }
  return name
}

export interface AiToolRef {
  serverId: string
  server: string
  tool: string
}

/**
 * Wire names for a list of (server, tool) pairs, unique across all servers.
 * A collision (two servers with the same name, or two names that sanitize or
 * truncate alike) gets a hash suffix of the pair's server id + tool.
 */
export function buildToolNameTable(refs: readonly AiToolRef[]): Map<string, AiToolRef> {
  const table = new Map<string, AiToolRef>()
  for (const ref of refs) {
    let name = wireToolName(ref.server, ref.tool)
    let n = 0
    while (table.has(name)) {
      n++
      const suffix = `_${shortHash(`${ref.serverId}\u0000${ref.tool}\u0000${n}`)}`
      const base = wireToolName(ref.server, ref.tool)
      name = base.slice(0, AI_TOOL_NAME_MAX - suffix.length) + suffix
    }
    table.set(name, ref)
  }
  return table
}
