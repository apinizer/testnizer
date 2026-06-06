/**
 * Minimal JSONPath evaluator for main-process assertion evaluation.
 *
 * This is a deliberate mirror of `src/renderer/lib/test-runner.ts`'s
 * `evaluateJsonPath` (same dot/bracket/wildcard/`.length` semantics). The two
 * copies live apart because of the strict main↔renderer process separation —
 * the renderer evaluates assertions for the Send button, the main process for
 * the Collection Runner. Keep them in lockstep: a divergence here produces the
 * "single request passes / runner fails" class of bug (see CLAUDE.md →
 * "Header assertion paralelliği").
 */

function tokenizeJsonPath(path: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < path.length) {
    if (path[i] === '.') {
      i++
      let token = ''
      while (i < path.length && path[i] !== '.' && path[i] !== '[') {
        token += path[i]
        i++
      }
      if (token) tokens.push(token)
    } else if (path[i] === '[') {
      i++
      let token = ''
      while (i < path.length && path[i] !== ']') {
        token += path[i]
        i++
      }
      i++ // skip ]
      tokens.push(`[${token}]`)
    } else {
      let token = ''
      while (i < path.length && path[i] !== '.' && path[i] !== '[') {
        token += path[i]
        i++
      }
      if (token) tokens.push(token)
    }
  }
  return tokens
}

function resolveTokens(obj: unknown, tokens: string[]): unknown {
  let current: unknown = obj

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (current === null || current === undefined) return undefined

    if (token === 'length') {
      if (Array.isArray(current)) return current.length
      if (typeof current === 'string') return current.length
      if (typeof current === 'object' && current !== null) {
        const record = current as Record<string, unknown>
        if ('length' in record) return record['length']
      }
      return undefined
    }

    if (token.startsWith('[') && token.endsWith(']')) {
      const inner = token.slice(1, -1)
      if (inner === '*') {
        if (!Array.isArray(current)) return undefined
        const remaining = tokens.slice(i + 1)
        if (remaining.length === 0) return current
        return current.map((item) => resolveTokens(item, remaining))
      }
      const index = parseInt(inner, 10)
      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index]
      } else {
        const key = inner.replace(/^['"]|['"]$/g, '')
        if (typeof current === 'object' && current !== null) {
          current = (current as Record<string, unknown>)[key]
        } else {
          return undefined
        }
      }
    } else {
      if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[token]
      } else {
        return undefined
      }
    }
  }
  return current
}

export function evaluateJsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith('$')) return undefined

  const stripped = path.slice(1) // remove leading $
  if (stripped === '' || stripped === '.') return obj

  if (stripped === '.length') {
    if (Array.isArray(obj)) return obj.length
    if (typeof obj === 'string') return obj.length
    return undefined
  }

  const tokens = tokenizeJsonPath(stripped)
  return resolveTokens(obj, tokens)
}
