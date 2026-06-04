/**
 * Failure injection: probabilistically replace a real response with an error.
 *
 * Modes:
 *   - status   return `config.status` (default 500) with a JSON error body
 *   - timeout  delay for `config.timeoutMs` then return 504 (simulates upstream hang)
 *   - random   pick uniformly between status and timeout
 *
 * `roll()` is the synchronous decision; the actual delay for timeout mode is
 * applied by the caller so the request handler stays in control of the timing.
 */

import type { FailureConfig } from './types'

export interface FailureInjection {
  kind: 'none' | 'status' | 'timeout'
  status?: number
  delayMs?: number
  /** JSON body string returned to the client. */
  body?: string
}

export function rollFailure(config: FailureConfig): FailureInjection {
  if (!config.enabled) return { kind: 'none' }
  const p = Math.max(0, Math.min(100, config.probability))
  if (p === 0) return { kind: 'none' }
  if (Math.random() * 100 >= p) return { kind: 'none' }

  let mode = config.mode
  if (mode === 'random') mode = Math.random() < 0.5 ? 'status' : 'timeout'

  if (mode === 'timeout') {
    const delayMs = Math.max(0, config.timeoutMs ?? 30000)
    return {
      kind: 'timeout',
      status: 504,
      delayMs,
      body: JSON.stringify({
        error: 'gateway_timeout',
        message: `Simulated timeout after ${delayMs}ms`,
      }),
    }
  }

  // status mode
  const status = config.status ?? 500
  return {
    kind: 'status',
    status,
    body: JSON.stringify({
      error: 'injected_failure',
      status,
      message: 'This response was injected by failure-injection settings.',
    }),
  }
}
