/**
 * IPC handlers for Mock MCP servers (issue #140).
 * Pattern: every handler returns `{ success, data?, error? }`.
 *
 * Channels:
 *   mockMcp:server:list|get|create|update|delete   — CRUD (`mock_mcp_servers`)
 *   mockMcp:server:start|stop|status               — live server lifecycle
 *   mockMcp:server:notify(id, kind)                — announce a tools / resources /
 *                                                    prompts list change now (issue #152)
 *   mockMcp:logs:get|clear                         — JSON-RPC request log
 * Events (main → renderer): `mockMcp:log` (MockMcpLogEntry), `mockMcp:status`
 * (MockMcpServerState).
 */

import { app, ipcMain, BrowserWindow } from 'electron'
import { getDb } from '../db/database'
import {
  createMockMcpServer,
  deleteMockMcpServer,
  getMockMcpServer,
  listMockMcpServers,
  updateMockMcpServer,
  type CreateMockMcpServerInput,
  type UpdateMockMcpServerInput,
} from '../db/mock-mcp.repo'
import { mockMcpServerManager } from '../mock-mcp/server'
import type { ListenErrorInfo } from '../../shared/listen-error'
import type { MockMcpNotifyKind, MockMcpServerConfig, MockMcpServerDef } from '../mock-mcp/types'

const NOTIFY_KINDS: readonly MockMcpNotifyKind[] = ['tools', 'resources', 'prompts']

type Result<T> = { success: true; data: T } | { success: false; error: string }

function ok<T>(data: T): Result<T> {
  return { success: true, data }
}

function fail(error: unknown): Result<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

/** A failed start / move; a bind failure also carries the structured reason (EN/TR in the UI). */
function failStart(r: {
  error: string
  errorInfo?: ListenErrorInfo
}): Result<never> & { errorInfo?: ListenErrorInfo } {
  return { success: false, error: r.error, ...(r.errorInfo ? { errorInfo: r.errorInfo } : {}) }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Live definition for a stored config; workspace is looked up for env-var templates. */
export function buildMockMcpDef(cfg: MockMcpServerConfig): MockMcpServerDef {
  let workspaceId: string | undefined
  try {
    const row = getDb()
      .prepare('SELECT workspace_id FROM projects WHERE id = ?')
      .get(cfg.projectId) as { workspace_id?: string } | undefined
    workspaceId = row?.workspace_id
  } catch {
    workspaceId = undefined
  }
  const { enabled: _enabled, createdAt: _c, updatedAt: _u, ...def } = cfg
  return { ...def, projectId: cfg.projectId, ...(workspaceId ? { workspaceId } : {}) }
}

/**
 * Re-sync every RUNNING Mock MCP server with its stored row (issue #154).
 * Called after anything other than the editor rewrites `mock_mcp_servers` —
 * project delete (FK cascade), git re-import (`replace` / pull prune) and
 * project-file imports that upsert rows. A vanished row stops the server; a
 * changed row is validated and hot-reloaded (or the server stops with the
 * reason). Status events go out exactly as for a manual stop / start.
 */
export async function reconcileRunningMockMcpServers(): Promise<void> {
  for (const { serverId } of mockMcpServerManager.list()) {
    let def: MockMcpServerDef | null = null
    try {
      const cfg = getMockMcpServer(serverId)
      def = cfg ? buildMockMcpDef(cfg) : null
    } catch (e) {
      // An unreadable row is as good as gone: never keep serving a config
      // the DB no longer backs.
      console.error('[mockMcp] reconcile: reading row failed:', (e as Error).message)
    }
    await mockMcpServerManager.syncWithStored(serverId, def)
  }
}

let eventsWired = false

export function registerMockMcpHandlers(): void {
  // ── CRUD ─────────────────────────────────────────────────────
  ipcMain.handle('mockMcp:server:list', async (_e, projectId: string) => {
    try {
      return ok(listMockMcpServers(projectId))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mockMcp:server:get', async (_e, id: string) => {
    try {
      return ok(getMockMcpServer(id))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mockMcp:server:create', async (_e, input: CreateMockMcpServerInput) => {
    try {
      return ok(createMockMcpServer(input))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    'mockMcp:server:update',
    async (_e, id: string, patch: UpdateMockMcpServerInput) => {
      try {
        const before = getMockMcpServer(id)
        if (!before) return fail('Mock MCP server not found')
        const running = mockMcpServerManager.status(id) === 'running'
        // Tester finding 11 (same rule as `mock:server:update`): a running
        // server moves to its new host/port BEFORE the row is written; a busy
        // address stores nothing and the server keeps serving where it was.
        const host = patch.host !== undefined ? patch.host.trim() : before.host
        const port = patch.port ?? before.port
        if (running && (host !== before.host || port !== before.port)) {
          const moved = await mockMcpServerManager.update(
            buildMockMcpDef({ ...before, host, port }),
          )
          if (!moved.ok) return failStart(moved)
        }
        let cfg: MockMcpServerConfig | null
        try {
          cfg = updateMockMcpServer(id, patch)
        } catch (e) {
          // The listener may already be on the new address: follow the row back.
          const stored = getMockMcpServer(id)
          if (running && stored) await mockMcpServerManager.update(buildMockMcpDef(stored))
          throw e
        }
        if (!cfg) return fail('Mock MCP server not found')
        // Hot reload: knobs apply to live sessions; a path / SSE change restarts
        // on the same port.
        if (running) {
          const r = await mockMcpServerManager.update(buildMockMcpDef(cfg))
          if (!r.ok) return failStart(r)
        }
        return ok(cfg)
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle('mockMcp:server:delete', async (_e, id: string) => {
    try {
      await mockMcpServerManager.stop(id)
      return ok(deleteMockMcpServer(id))
    } catch (e) {
      return fail(e)
    }
  })

  // ── Lifecycle ────────────────────────────────────────────────
  ipcMain.handle('mockMcp:server:start', async (_e, id: string) => {
    try {
      const cfg = getMockMcpServer(id)
      if (!cfg) return fail('Mock MCP server not found')
      const r = await mockMcpServerManager.start(buildMockMcpDef(cfg))
      return r.ok ? ok(r.state) : failStart(r)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mockMcp:server:stop', async (_e, id: string) => {
    try {
      await mockMcpServerManager.stop(id)
      return ok(mockMcpServerManager.state(id))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mockMcp:server:status', async (_e, id: string) => {
    try {
      return ok(mockMcpServerManager.state(id))
    } catch (e) {
      return fail(e)
    }
  })

  // Sends `notifications/<kind>/list_changed` to 2026-07-28 `subscriptions/listen`
  // streams and legacy SSE sessions; `data` is false when the server is not running.
  ipcMain.handle('mockMcp:server:notify', async (_e, id: string, kind: MockMcpNotifyKind) => {
    try {
      if (!NOTIFY_KINDS.includes(kind)) return fail(`Unknown notification kind "${String(kind)}"`)
      return ok(mockMcpServerManager.notify(id, kind))
    } catch (e) {
      return fail(e)
    }
  })

  // ── Logs ─────────────────────────────────────────────────────
  ipcMain.handle('mockMcp:logs:get', async (_e, serverId: string) => {
    try {
      return ok(mockMcpServerManager.getLogs(serverId))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mockMcp:logs:clear', async (_e, serverId: string) => {
    try {
      mockMcpServerManager.clearLogs(serverId)
      return ok(true)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Events + shutdown (once per process; tests re-register handlers) ──
  if (!eventsWired) {
    eventsWired = true
    mockMcpServerManager.on('log', (entry) => broadcast('mockMcp:log', entry))
    mockMcpServerManager.on('status', (state) => broadcast('mockMcp:status', state))
    // Free the ports on quit; listeners would otherwise hold them until exit.
    app.on('will-quit', () => {
      void mockMcpServerManager.stopAll()
    })
  }
}
