/**
 * MCP Security Scan (issue #142) — the per-tab slice of `mcp.store.ts`:
 * state shape, idle values, and the event handlers. Events are routed by
 * `scanId` to the tab that STARTED the scan (never "the active tab");
 * events that race the `securityScan` reply wait in a small orphan bucket.
 *
 * Kept out of `mcp.store.ts` (already large); the store injects its routing
 * helpers, so this module never imports the store.
 */
import type {
  McpSecurityDoneEvent,
  McpSecurityFinding,
  McpSecurityFindingEvent,
  McpSecurityProgress,
  McpSecurityProgressEvent,
  McpSecurityReport,
} from '../types/mcp'

export interface McpSecurityTabState {
  /** Scan running / last run on this tab — routes `mcp:security:*` events here. */
  securityScanId: string | null
  securityRunning: boolean
  securityProgress: McpSecurityProgress | null
  /** Findings as they stream in (replaced by the report's on `done`). */
  securityFindings: McpSecurityFinding[]
  securityReport: McpSecurityReport | null
  securityError: string | null
  /** Opt-in rate-limit probe. The ONLY persisted security field (default false). */
  securityRateLimitProbe: boolean
}

export type McpSecurityTransientState = Omit<McpSecurityTabState, 'securityRateLimitProbe'>

/** Everything but the opt-in — the scan result is never persisted. */
export function securityIdle(): McpSecurityTransientState {
  return {
    securityScanId: null,
    securityRunning: false,
    securityProgress: null,
    securityFindings: [],
    securityReport: null,
    securityError: null,
  }
}

type Patch<S> = Partial<S> | ((s: S) => Partial<S>)

export interface SecurityRouting<S extends McpSecurityTabState> {
  /** The tab whose slice holds `scanId` (live slice first), or undefined. */
  findTab: (scanId: string) => { tabId: string | null } | undefined
  patchTab: (tabId: string | null, patch: Patch<S>) => void
}

export function upsertFinding(
  list: McpSecurityFinding[],
  finding: McpSecurityFinding,
): McpSecurityFinding[] {
  const i = list.findIndex((f) => f.id === finding.id)
  if (i === -1) return [...list, finding]
  const next = list.slice()
  next[i] = finding
  return next
}

export function securityDonePatch(evt: McpSecurityDoneEvent): Partial<McpSecurityTabState> {
  const report = evt.report ?? null
  return {
    securityRunning: false,
    securityReport: report,
    securityError: evt.error ?? null,
    ...(report
      ? {
          securityFindings: report.categories.flatMap((c) => c.findings),
          securityProgress: null,
        }
      : {}),
  }
}

// ─── Orphans (events that beat the start reply) ─────────────────────────────

interface Orphan {
  findings: McpSecurityFinding[]
  progress?: McpSecurityProgress
  done?: McpSecurityDoneEvent
}

const ORPHAN_LIMIT = 8
const orphans = new Map<string, Orphan>()

function orphan(scanId: string): Orphan {
  let bucket = orphans.get(scanId)
  if (!bucket) {
    bucket = { findings: [] }
    orphans.set(scanId, bucket)
    if (orphans.size > ORPHAN_LIMIT) {
      const oldest = orphans.keys().next().value
      if (oldest !== undefined) orphans.delete(oldest)
    }
  }
  return bucket
}

/** What arrived for `scanId` before the tab knew it, as a patch for that tab. */
export function claimSecurityOrphans(
  scanId: string,
  current: McpSecurityFinding[],
): Partial<McpSecurityTabState> {
  const bucket = orphans.get(scanId)
  orphans.delete(scanId)
  if (!bucket) return {}
  return {
    securityFindings: bucket.findings.reduce(upsertFinding, current),
    ...(bucket.progress ? { securityProgress: bucket.progress } : {}),
    ...(bucket.done ? securityDonePatch(bucket.done) : {}),
  }
}

// ─── Event handlers ─────────────────────────────────────────────────────────

const isScanEvent = (evt: unknown): evt is { scanId: string } =>
  !!evt && typeof (evt as { scanId?: unknown }).scanId === 'string'

export function securityEventHandlers<S extends McpSecurityTabState>(
  routing: SecurityRouting<S>,
): {
  onProgress: (evt: McpSecurityProgressEvent) => void
  onFinding: (evt: McpSecurityFindingEvent) => void
  onDone: (evt: McpSecurityDoneEvent) => void
} {
  const route = (scanId: string, patch: Patch<S>): boolean => {
    const owner = routing.findTab(scanId)
    if (!owner) return false
    routing.patchTab(owner.tabId, patch)
    return true
  }
  return {
    onProgress: (evt) => {
      if (!isScanEvent(evt)) return
      const progress: McpSecurityProgress = {
        done: Number(evt.done) || 0,
        total: Number(evt.total) || 0,
        current: typeof evt.current === 'string' ? evt.current : '',
      }
      const patch = { securityProgress: progress } as Partial<S>
      if (!route(evt.scanId, patch)) orphan(evt.scanId).progress = progress
    },
    onFinding: (evt) => {
      if (!isScanEvent(evt) || !evt.finding || typeof evt.finding.id !== 'string') return
      const routed = route(
        evt.scanId,
        (s) => ({ securityFindings: upsertFinding(s.securityFindings, evt.finding) }) as Partial<S>,
      )
      if (!routed) {
        const bucket = orphan(evt.scanId)
        bucket.findings = upsertFinding(bucket.findings, evt.finding)
      }
    },
    onDone: (evt) => {
      if (!isScanEvent(evt)) return
      if (!route(evt.scanId, securityDonePatch(evt) as Partial<S>)) orphan(evt.scanId).done = evt
    },
  }
}
