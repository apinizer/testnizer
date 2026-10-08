/**
 * IPC handlers for Mock MCP servers (issue #140).
 * Pattern: every handler returns `{ success, data?, error? }`.
 *
 * Channels:
 *   mockMcp:server:list|get|create|update|delete   — CRUD (`mock_mcp_servers`)
 *   mockMcp:server:start|stop|status               — live server lifecycle
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
import type { MockMcpServerConfig, MockMcpServerDef } from '../mock-mcp/types'

type Result<T> = { success: true; data: T } | { success: false; error: string }

function ok<T>(data: T): Result<T> {
  return { success: true, data }
}

function fail(error: unknown): Result<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
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
        const cfg = updateMockMcpServer(id, patch)
        if (!cfg) return fail('Mock MCP server not found')
        // Hot reload: knobs apply to live sessions; host/port/path/SSE restart.
        // A failed restart surfaces through the `mockMcp:status` event.
        if (mockMcpServerManager.status(id) === 'running') {
          await mockMcpServerManager.update(buildMockMcpDef(cfg))
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
      return r.ok ? ok(r.state) : fail(r.error)
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
