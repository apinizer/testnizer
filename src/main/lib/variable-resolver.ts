/**
 * Main-process variable resolver (Collection Runner, Mock Server).
 *
 * The `{{…}}` substitution loop and the dynamic-variable table live in
 * `src/shared/dynamic-variables.ts`, which the renderer's Send resolver uses as
 * well — so `{{$guid}}`, chained `{{baseUrl}}` → `https://{{host}}` and unknown
 * placeholders behave identically on Send, Run and Mock. (This file used to
 * hold a hand copy of the renderer's generators.)
 */
import { resolveTemplate } from '../../shared/dynamic-variables'

/**
 * Resolve `{{var}}` and `{{$dynamicValue}}` placeholders in a single string.
 * Unknown variables stay `{{name}}`; unknown dynamic variables stay as written.
 */
export function resolveVariables(template: string, vars: Record<string, string>): string {
  return resolveTemplate(template, (name) => (name in vars ? vars[name] : undefined))
}
