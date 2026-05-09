/**
 * Per-server rate limiter — sliding-window-ish token bucket.
 *
 * Each server keeps a Map<key, { count, windowStart }>. When a request comes
 * in, we check whether we're inside the current window: if so, increment the
 * counter; if not, reset. When the count exceeds `requestsPerWindow` we
 * return a 429 with Retry-After.
 *
 * Scope:
 *   - 'global' uses the literal key '*'
 *   - 'ip'     uses the client's remoteAddress
 *
 * Buckets are wiped automatically when a server stops via `clearLimiter`.
 */

import type { RateLimitConfig } from './types'

interface Bucket {
  count: number
  windowStart: number
}

const buckets = new Map<string, Map<string, Bucket>>()

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  /** Unix-ms timestamp when the window resets. */
  resetAt: number
  /** Seconds the client should wait before retrying (only when blocked). */
  retryAfterSec: number
}

export function checkRateLimit(
  serverId: string,
  config: RateLimitConfig,
  remoteAddress: string,
  now: number = Date.now(),
): RateLimitDecision {
  if (!config.enabled || config.requestsPerWindow <= 0) {
    return { allowed: true, remaining: Infinity, resetAt: 0, retryAfterSec: 0 }
  }
  const key = config.scope === 'ip' ? remoteAddress || 'unknown' : '*'
  let serverMap = buckets.get(serverId)
  if (!serverMap) {
    serverMap = new Map()
    buckets.set(serverId, serverMap)
  }
  let bucket = serverMap.get(key)
  if (!bucket || now - bucket.windowStart >= config.windowMs) {
    bucket = { count: 0, windowStart: now }
    serverMap.set(key, bucket)
  }

  bucket.count += 1
  const resetAt = bucket.windowStart + config.windowMs

  if (bucket.count > config.requestsPerWindow) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    }
  }
  return {
    allowed: true,
    remaining: Math.max(0, config.requestsPerWindow - bucket.count),
    resetAt,
    retryAfterSec: 0,
  }
}

export function clearLimiter(serverId: string): void {
  buckets.delete(serverId)
}

export function clearAllLimiters(): void {
  buckets.clear()
}
