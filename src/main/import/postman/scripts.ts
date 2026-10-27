/**
 * Postman `event[]` → Testnizer pre-request / post-response scripts, plus the
 * import report for script features Testnizer does not run (issue #276).
 *
 * Scripts are stored VERBATIM (one runtime, `src/shared/script/`); nothing
 * here rewrites script text. The report names, per item:
 *  - disabled events (`event.disabled: true`) — not imported, like Postman
 *    does not run them;
 *  - URL-only scripts (`script.src` without `exec`);
 *  - unknown `listen` values;
 *  - `pm.require(…)` packages (`script.packages`), `pm.vault.*` and
 *    `{{vault:…}}` references.
 */
import type { PostmanEvent } from './types'

export interface ExtractedScripts {
  preScript?: string
  postScript?: string
}

function execText(exec: unknown): string | undefined {
  if (Array.isArray(exec))
    return exec.map((l) => (typeof l === 'string' ? l : String(l))).join('\n')
  if (typeof exec === 'string') return exec
  return undefined
}

/**
 * Pre/post scripts of one level. Several events with the same `listen` all
 * run in Postman, in order — they are joined (the last one used to win).
 */
export function extractEventScripts(
  events: PostmanEvent[] | undefined,
  label: string,
  warnings: string[],
): ExtractedScripts {
  if (!Array.isArray(events)) return {}
  const pre: string[] = []
  const post: string[] = []
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue
    const kind = ev.listen === 'prerequest' ? 'pre-request' : ev.listen === 'test' ? 'test' : null
    const text = execText(ev.script?.exec)
    if (!kind) {
      if (text && text.trim())
        warnings.push(
          `"${label}": script for event "${String(ev.listen)}" was not imported (only pre-request and test scripts run in Testnizer).`,
        )
      continue
    }
    if (ev.disabled === true) {
      if (text && text.trim())
        warnings.push(`"${label}": the ${kind} script is disabled in Postman and was not imported.`)
      continue
    }
    if (!text) {
      if (ev.script?.src)
        warnings.push(
          `"${label}": the ${kind} script is loaded from a URL (script.src) and was not imported.`,
        )
      continue
    }
    const packages = ev.script?.packages
    if (packages && typeof packages === 'object' && Object.keys(packages).length > 0) {
      warnings.push(
        `"${label}": the ${kind} script uses Postman package(s) ${Object.keys(packages).join(', ')} via pm.require — Testnizer cannot load them; the script stops with "pm.require is not supported in Testnizer" where it calls pm.require.`,
      )
    } else if (/\bpm\.require\s*\(/.test(text)) {
      warnings.push(
        `"${label}": the ${kind} script calls pm.require — Postman package libraries are not available in Testnizer; the script stops with "pm.require is not supported in Testnizer" there.`,
      )
    }
    if (/\bpm\.vault\b/.test(text)) {
      // Issue #281: pm.vault works — on this project's secret variables.
      warnings.push(
        `"${label}": the ${kind} script uses pm.vault — in Testnizer it reads and writes this project's secret variables (Globals); vault values are not in the file, enter them there as secret variables.`,
      )
    }
    ;(kind === 'pre-request' ? pre : post).push(text)
  }
  const out: ExtractedScripts = {}
  if (pre.length > 0) out.preScript = pre.join('\n')
  if (post.length > 0) out.postScript = post.join('\n')
  return out
}

/** Back-compat name (tests, suite import): same mapping, report discarded. */
export function extractPostmanEventScripts(events: PostmanEvent[] | undefined): ExtractedScripts {
  return extractEventScripts(events, '', [])
}

/** `{{vault:name}}` references anywhere in a serialised request. */
export function vaultReferences(text: string): string[] {
  const out = new Set<string>()
  const re = /\{\{\s*vault:([^}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.add(m[1].trim())
  return [...out]
}
