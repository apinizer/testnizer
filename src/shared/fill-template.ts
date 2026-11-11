/**
 * THE placeholder filler for user-facing templates (`{name}` → value).
 *
 * One pass with a callback replacement, never `String.replace(str, value)`:
 * a value is inserted verbatim (a project named `$&` or `$1` stays as typed —
 * a replacement STRING would expand those patterns), and a value that itself
 * contains `{name}` is not substituted again (a translated cause nested inside
 * an outer sentence keeps its text). An unknown placeholder stays literal.
 */
export type TemplateValues = Readonly<Record<string, string | number>>

export function fillTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  )
}
