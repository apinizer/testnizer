import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database'
import { addSaveHistory } from '../db/branch.repo'

interface ProjectExport {
  version: string
  exportedAt: number
  project: Record<string, unknown>
  folders: Record<string, unknown>[]
  endpoints: Record<string, unknown>[]
  savedRequests: Record<string, unknown>[]
  environments: Record<string, unknown>[]
  branches: Record<string, unknown>[]
}

function exportProjectData(projectId: string): ProjectExport {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>
  const folders = db.prepare('SELECT * FROM folders WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  const endpoints = db.prepare('SELECT * FROM endpoints WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  const savedRequests = db.prepare('SELECT * FROM saved_requests WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  const branches = db.prepare('SELECT * FROM branches WHERE project_id = ?').all(projectId) as Record<string, unknown>[]

  // Get environments for project's workspace
  const workspaceId = project?.workspace_id as string
  const environments = workspaceId
    ? db.prepare('SELECT * FROM environments WHERE workspace_id = ?').all(workspaceId) as Record<string, unknown>[]
    : []

  return {
    version: '1.0.0',
    exportedAt: Date.now(),
    project,
    folders,
    endpoints,
    savedRequests,
    environments,
    branches,
  }
}

function getSecureStore(): Promise<{ get(key: string): unknown; set(key: string, value: unknown): void }> {
  // Use a separate electron-store for git credentials
  return import('electron-store').then(({ default: Store }) => {
    return new Store({
      name: 'git-credentials',
      encryptionKey: 'apinizer-secure-key-v1',
    }) as unknown as { get(key: string): unknown; set(key: string, value: unknown): void }
  })
}

export function registerSaveHandlers(): void {
  // ─── Save Local ─────────────────────────────────────────────
  ipcMain.handle('save:local', async (_event, payload: {
    projectId: string
    directoryPath?: string
  }) => {
    try {
      let dirPath = payload.directoryPath

      if (!dirPath) {
        const win = BrowserWindow.getFocusedWindow()
        const result = await dialog.showOpenDialog(win!, {
          properties: ['openDirectory', 'createDirectory'],
          title: 'Select save directory',
        })
        if (result.canceled || !result.filePaths[0]) {
          return { success: false, error: 'Cancelled' }
        }
        dirPath = result.filePaths[0]
      }

      const data = exportProjectData(payload.projectId)
      const projectName = (data.project?.name as string || 'project').replace(/[^a-zA-Z0-9-_]/g, '_')
      const dateStr = new Date().toISOString().slice(0, 10)
      const fileName = `${projectName}-${dateStr}.json`
      const filePath = join(dirPath, fileName)

      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

      addSaveHistory({
        project_id: payload.projectId,
        mode: 'local',
        path: filePath,
        message: `Saved to ${fileName}`,
      })

      return { success: true, data: { path: filePath, fileName } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Select Directory ───────────────────────────────────────
  ipcMain.handle('save:selectDirectory', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select save directory',
      })
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Cancelled' }
      }
      return { success: true, data: result.filePaths[0] }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Save to Git ────────────────────────────────────────────
  ipcMain.handle('save:git', async (_event, payload: {
    projectId: string
    repoUrl: string
    branch: string
    username: string
    token: string
    commitMessage: string
  }) => {
    try {
      const { simpleGit } = await import('simple-git')

      const data = exportProjectData(payload.projectId)
      const projectName = (data.project?.name as string || 'project').replace(/[^a-zA-Z0-9-_]/g, '_')

      // Build authenticated URL
      const urlObj = new URL(payload.repoUrl)
      urlObj.username = encodeURIComponent(payload.username)
      urlObj.password = encodeURIComponent(payload.token)
      const authUrl = urlObj.toString()

      // Work in a temp directory
      const tmpDir = join(tmpdir(), `apinizer-git-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit(tmpDir)

      // Clone or pull
      await git.clone(authUrl, tmpDir, ['--branch', payload.branch, '--single-branch', '--depth', '1'])
        .catch(async () => {
          // If branch doesn't exist, clone default and create branch
          await git.clone(authUrl, tmpDir, ['--depth', '1'])
          await git.checkoutLocalBranch(payload.branch)
        })

      // Write project JSON
      const fileName = `${projectName}.json`
      const filePath = join(tmpDir, fileName)
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

      // Commit and push
      await git.add(fileName)
      await git.commit(payload.commitMessage || `Update ${projectName}`)
      await git.push('origin', payload.branch)

      // Save credentials securely
      const store = await getSecureStore()
      store.set(`git.${Buffer.from(payload.repoUrl).toString('base64').slice(0, 32)}`, {
        repoUrl: payload.repoUrl,
        username: payload.username,
        // token is stored encrypted by electron-store
        token: payload.token,
      })

      addSaveHistory({
        project_id: payload.projectId,
        mode: 'git',
        path: `${payload.repoUrl}@${payload.branch}`,
        message: payload.commitMessage || `Update ${projectName}`,
      })

      // Cleanup
      const { rmSync } = await import('fs')
      rmSync(tmpDir, { recursive: true, force: true })

      return { success: true, data: { repoUrl: payload.repoUrl, branch: payload.branch } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Open from Git ──────────────────────────────────────────
  ipcMain.handle('save:gitListFiles', async (_event, payload: {
    repoUrl: string
    branch: string
    username: string
    token: string
  }) => {
    try {
      const { simpleGit } = await import('simple-git')

      const urlObj = new URL(payload.repoUrl)
      urlObj.username = encodeURIComponent(payload.username)
      urlObj.password = encodeURIComponent(payload.token)
      const authUrl = urlObj.toString()

      const tmpDir = join(tmpdir(), `apinizer-git-list-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit(tmpDir)
      await git.clone(authUrl, tmpDir, ['--branch', payload.branch, '--single-branch', '--depth', '1'])

      // List JSON files
      const files = readdirSync(tmpDir)
        .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        .map((f) => {
          const stat = require('fs').statSync(join(tmpDir, f))
          return { name: f, path: join(tmpDir, f), size: stat.size }
        })

      return { success: true, data: { tmpDir, files } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('save:gitReadFile', async (_event, filePath: string) => {
    try {
      if (!existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }
      const content = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('save:gitCleanup', async (_event, tmpDir: string) => {
    try {
      const { rmSync } = await import('fs')
      rmSync(tmpDir, { recursive: true, force: true })
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Stored Git Credentials ─────────────────────────────────
  ipcMain.handle('save:getGitCredentials', async () => {
    try {
      const store = await getSecureStore()
      const all = store.get('git') as Record<string, unknown> | undefined
      return { success: true, data: all || {} }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
