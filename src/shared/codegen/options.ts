/**
 * Per-variant snippet options (issue #280) — Postman's option set where it is
 * meaningful: indent count / type, trim body, follow redirects, timeout,
 * async/await, include boilerplate. A variant lists the defs it honours; the
 * UI renders the popover from them; `resolveOptions` fills the defaults.
 *
 * Redirects and timeout combine with the REQUEST's settings: a request that
 * turned redirects off never follows in the snippet, and a request with an
 * explicit timeout carries it unless the option sets another one.
 */
import type { CodegenOptionDef, CodegenOptions, CodegenRequest } from './types'

export function indentCountOpt(dflt: number): CodegenOptionDef {
  return {
    id: 'indentCount',
    labelKey: 'codeGen.option.indentCount',
    type: 'number',
    default: dflt,
    min: 1,
  }
}

export function indentTypeOpt(dflt: 'space' | 'tab' = 'space'): CodegenOptionDef {
  return {
    id: 'indentType',
    labelKey: 'codeGen.option.indentType',
    type: 'enum',
    default: dflt,
    choices: [
      { value: 'space', labelKey: 'codeGen.option.indentSpace' },
      { value: 'tab', labelKey: 'codeGen.option.indentTab' },
    ],
  }
}

export const TRIM_BODY: CodegenOptionDef = {
  id: 'trimRequestBody',
  labelKey: 'codeGen.option.trimRequestBody',
  type: 'boolean',
  default: false,
}

export function followRedirectOpt(dflt = true): CodegenOptionDef {
  return {
    id: 'followRedirect',
    labelKey: 'codeGen.option.followRedirect',
    type: 'boolean',
    default: dflt,
  }
}

export const TIMEOUT: CodegenOptionDef = {
  id: 'requestTimeout',
  labelKey: 'codeGen.option.requestTimeout',
  type: 'number',
  default: 0,
  min: 0,
}

export const ASYNC_AWAIT: CodegenOptionDef = {
  id: 'asyncAwait',
  labelKey: 'codeGen.option.asyncAwait',
  type: 'boolean',
  default: true,
}

export const BOILERPLATE: CodegenOptionDef = {
  id: 'includeBoilerplate',
  labelKey: 'codeGen.option.includeBoilerplate',
  type: 'boolean',
  default: false,
}

/** The usual set: indent + trim + redirects + timeout. */
export function coreOptions(indent: number, type: 'space' | 'tab' = 'space'): CodegenOptionDef[] {
  return [indentCountOpt(indent), indentTypeOpt(type), TRIM_BODY, followRedirectOpt(), TIMEOUT]
}

/** Defaults filled in; unknown keys and values of the wrong type dropped. */
export function resolveOptions(
  defs: readonly CodegenOptionDef[],
  given: CodegenOptions | undefined,
): CodegenOptions {
  const out: CodegenOptions = {}
  for (const d of defs) {
    const v = given?.[d.id]
    const ok =
      (d.type === 'boolean' && typeof v === 'boolean') ||
      (d.type === 'number' && typeof v === 'number' && Number.isFinite(v) && v >= (d.min ?? 0)) ||
      (d.type === 'enum' && typeof v === 'string' && !!d.choices?.some((c) => c.value === v))
    out[d.id] = ok ? (v as CodegenOptions[string]) : d.default
  }
  return out
}

/** One indent level. */
export function indentUnit(o: CodegenOptions, fallback = 2): string {
  if (o.indentType === 'tab') return '\t'
  const n = typeof o.indentCount === 'number' ? Math.floor(o.indentCount) : fallback
  return ' '.repeat(Math.max(1, n))
}

/** Should the snippet follow redirects? Option AND the request's own setting. */
export function shouldFollow(req: CodegenRequest, o: CodegenOptions): boolean {
  return o.followRedirect !== false && req.settings.followRedirects !== false
}

/** Timeout in ms (0 = none): the option when set, otherwise the request's explicit one. */
export function timeoutMs(req: CodegenRequest, o: CodegenOptions): number {
  const opt = typeof o.requestTimeout === 'number' ? o.requestTimeout : 0
  return opt > 0 ? opt : (req.settings.timeoutMs ?? 0)
}

/** The raw / JSON body text, trimmed when the option asks for it. */
export function rawContent(req: CodegenRequest, o: CodegenOptions): string | undefined {
  if (req.body?.mode !== 'raw') return undefined
  return o.trimRequestBody === true ? req.body.content.trim() : req.body.content
}
