/**
 * YAML ↔ JSON converter — bidirectional, js-yaml backed (already a renderer
 * dep via the openapi tooling). YAML output uses the safe schema and disables
 * `!!js/*` tags by default; JSON output is plain stringify.
 */

import yaml from 'js-yaml'

export interface ConvertOptions {
  indent?: number
  sortKeys?: boolean
}

export type ConvertResult = { ok: true; output: string } | { ok: false; error: string }

export function yamlToJson(source: string, opts: ConvertOptions = {}): ConvertResult {
  const indent = opts.indent ?? 2
  if (!source.trim()) return { ok: true, output: '' }
  try {
    const data = yaml.load(source, { json: true })
    return {
      ok: true,
      output: stableStringify(data, indent, opts.sortKeys ?? false),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function jsonToYaml(source: string, opts: ConvertOptions = {}): ConvertResult {
  const indent = opts.indent ?? 2
  if (!source.trim()) return { ok: true, output: '' }
  try {
    const data = JSON.parse(source) as unknown
    const out = yaml.dump(data, {
      indent,
      sortKeys: opts.sortKeys ?? false,
      lineWidth: 120,
      noRefs: true,
      schema: yaml.JSON_SCHEMA, // no JS-specific tags
    })
    return { ok: true, output: out.trimEnd() + '\n' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function stableStringify(value: unknown, indent: number, sortKeys: boolean): string {
  if (!sortKeys) return JSON.stringify(value, null, indent)
  return JSON.stringify(value, sortReplacer(), indent)
}

function sortReplacer(): (key: string, value: unknown) => unknown {
  return (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]
      return sorted
    }
    return value
  }
}
