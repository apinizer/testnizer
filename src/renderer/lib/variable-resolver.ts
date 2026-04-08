import { resolveDynamicValue } from './dynamic-values'

/**
 * Resolves {{variable}} placeholders in a template string.
 * Supports:
 *  - {{varName}} — from environment or global variables
 *  - {{$dynamicValue}} — built-in dynamic values like $randomInt, $timestamp, etc.
 */
export function resolveVariables(
  template: string,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {}
): string {
  if (!template) return template

  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expression: string) => {
    const trimmed = expression.trim()

    // Dynamic values start with $
    if (trimmed.startsWith('$')) {
      return resolveDynamicValue(trimmed)
    }

    // Check environment variables first, then globals
    if (trimmed in envVars) {
      return envVars[trimmed]
    }

    if (trimmed in globalVars) {
      return globalVars[trimmed]
    }

    // Return original if not found
    return `{{${trimmed}}}`
  })
}

/**
 * Resolves variables in all string values of a key-value pair array.
 */
export function resolveKeyValuePairs(
  pairs: Array<{ key: string; value: string; enabled: boolean }>,
  envVars: Record<string, string>,
  globalVars: Record<string, string> = {}
): Array<{ key: string; value: string; enabled: boolean }> {
  return pairs.map((pair) => ({
    ...pair,
    key: resolveVariables(pair.key, envVars, globalVars),
    value: resolveVariables(pair.value, envVars, globalVars),
  }))
}
