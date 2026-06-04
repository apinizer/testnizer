/**
 * Endpoint matcher: choose the best mock endpoint for an incoming request.
 *
 * Path modes:
 *   - exact     literal string match
 *   - param     :name placeholders (e.g. /users/:id) — extracts named params
 *   - wildcard  glob-like with `*` as any-segment (`/api/*`) and `**` greedy
 *   - regex     full regex on the path
 *
 * Method `ANY` matches any HTTP verb. Among multiple matches the highest
 * `priority` wins, ties broken by mode specificity (exact > param > wildcard > regex).
 */

import type { MockMethod, MockPathMode } from './types'

export interface MatchableEndpoint {
  id: string
  method: MockMethod
  path: string
  pathMode: MockPathMode
  priority: number
  enabled: boolean
}

export interface MatchResult {
  endpoint: MatchableEndpoint
  /** Path parameters extracted (param mode) or named regex groups (regex mode). */
  params: Record<string, string>
}

/** Find the best matching endpoint for the given request. */
export function matchEndpoint(
  endpoints: MatchableEndpoint[],
  method: string,
  path: string,
): MatchResult | null {
  const candidates: { match: MatchResult; score: number }[] = []
  for (const ep of endpoints) {
    if (!ep.enabled) continue
    if (ep.method !== 'ANY' && ep.method !== method.toUpperCase()) continue
    const params = matchPath(ep.pathMode, ep.path, path)
    if (params === null) continue
    candidates.push({
      match: { endpoint: ep, params },
      score: scoreOf(ep),
    })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].match
}

function scoreOf(ep: MatchableEndpoint): number {
  // priority dominates; specificity is the tie-breaker.
  const modeScore =
    ep.pathMode === 'exact' ? 4 : ep.pathMode === 'param' ? 3 : ep.pathMode === 'regex' ? 2 : 1
  return ep.priority * 100 + modeScore
}

/** Test a single path. Returns extracted params on match, or `null`. */
export function matchPath(
  mode: MockPathMode,
  template: string,
  actual: string,
): Record<string, string> | null {
  const norm = stripTrailingSlash(actual)
  const tpl = stripTrailingSlash(template)

  if (mode === 'exact') {
    return norm === tpl ? {} : null
  }

  if (mode === 'param') {
    return matchParamPath(tpl, norm)
  }

  if (mode === 'wildcard') {
    return matchWildcardPath(tpl, norm)
  }

  if (mode === 'regex') {
    // Reject obviously dangerous patterns before compiling — ReDoS via
    // nested quantifiers (`(a+)+`, `(.*)*`, `(.+)*`) can freeze the main
    // process for seconds on a crafted path. Pattern length is also
    // bounded so an attacker can't blow stack with deeply nested groups.
    if (template.length > 512) return null
    if (/(\([^)]+\)|\[[^\]]+\])[+*]{1,2}\s*[+*]/.test(template)) return null
    // Cap input length too — pathological matchers on multi-KB paths
    // hurt regardless of the pattern.
    if (actual.length > 8192) return null
    try {
      const re = new RegExp(template)
      const m = re.exec(actual)
      if (!m) return null
      return m.groups ?? {}
    } catch {
      return null
    }
  }

  return null
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1)
  return p
}

function matchParamPath(template: string, actual: string): Record<string, string> | null {
  const tParts = template.split('/')
  const aParts = actual.split('/')
  if (tParts.length !== aParts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i]
    const a = aParts[i]
    if (t.startsWith(':')) {
      params[t.slice(1)] = decodeURIComponent(a)
    } else if (t !== a) {
      return null
    }
  }
  return params
}

function matchWildcardPath(template: string, actual: string): Record<string, string> | null {
  // Convert a wildcard pattern to a RegExp. `*` matches any single path segment;
  // `**` matches any number of segments greedily.
  const escaped = template
    .split('/')
    .map((seg) => {
      if (seg === '**') return '__DBL__'
      if (seg === '*') return '[^/]*'
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
    .replace(/__DBL__/g, '.*')
  const re = new RegExp(`^${escaped}$`)
  return re.test(actual) ? {} : null
}
