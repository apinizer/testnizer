/**
 * Telemetry stub — minimal scaffolding for Sentry-style crash reporting.
 *
 * Behaviour:
 * - **Default off.** Nothing is sent until the user explicitly toggles
 *   `telemetryEnabled` in Settings.
 * - When enabled at startup AND a DSN is configured at build time
 *   (`SENTRY_DSN` env var), `@sentry/electron` is dynamically required and
 *   initialized. If the dependency isn't installed (typical for the open-
 *   source distribution), this no-ops cleanly.
 * - PII-free: no breadcrumbs, no request bodies, no headers — only crash
 *   stack traces and the app version. Configurable via Sentry options once
 *   the actual SDK is wired in Sprint 7.
 *
 * The user-facing toggle lives in SettingsModal; the on-launch read of the
 * setting happens in `src/main/index.ts` via `maybeInitTelemetry`.
 */

import { app } from 'electron'

let initialized = false

interface SentryModule {
  init: (opts: Record<string, unknown>) => void
  captureException: (err: unknown) => void
}

export async function maybeInitTelemetry(enabled: boolean): Promise<void> {
  if (initialized) return
  if (!enabled) return

  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    // No DSN configured — nothing to do. This is the normal path for OSS
    // builds without telemetry.
    return
  }

  try {
    // Dynamic require so the dependency is optional.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/electron/main') as SentryModule
    Sentry.init({
      dsn,
      release: `testnizer@${app.getVersion()}`,
      autoSessionTracking: false,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // Strip request bodies / IPC payloads — only stack traces should leave.
      beforeBreadcrumb: () => null,
    })
    initialized = true
    console.log('[telemetry] Sentry initialized (opt-in)')
  } catch (err) {
    // @sentry/electron not installed — soft no-op.
    console.log('[telemetry] @sentry/electron not available:', (err as Error).message)
  }
}
