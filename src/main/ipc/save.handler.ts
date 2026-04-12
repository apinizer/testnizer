import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database'
import { addSaveHistory } from '../db/branch.repo'

// ─── Full Project Export Format ──────────────────────────────────
interface ProjectExport {
  version: string
  exportedAt: number
  project: Record<string, unknown>
  folders: Record<string, unknown>[]
  endpoints: Record<string, unknown>[]
  endpointCases: Record<string, unknown>[]
  savedRequests: Record<string, unknown>[]
  environments: Record<string, unknown>[]
  environmentVariables: Record<string, unknown>[]
  globalVariables: Record<string, unknown>[]
  branches: Record<string, unknown>[]
}

function exportProjectData(projectId: string): ProjectExport {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>
  const folders = db.prepare('SELECT * FROM folders WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  const endpoints = db.prepare('SELECT * FROM endpoints WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  const savedRequests = db.prepare('SELECT * FROM saved_requests WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  const branches = db.prepare('SELECT * FROM branches WHERE project_id = ?').all(projectId) as Record<string, unknown>[]

  // Endpoint cases for all endpoints
  const endpointIds = endpoints.map((e) => e.id as string)
  let endpointCases: Record<string, unknown>[] = []
  if (endpointIds.length > 0) {
    const placeholders = endpointIds.map(() => '?').join(',')
    endpointCases = db.prepare(
      `SELECT * FROM endpoint_cases WHERE endpoint_id IN (${placeholders})`
    ).all(...endpointIds) as Record<string, unknown>[]
  }

  // Environments + variables for project's workspace
  const workspaceId = project?.workspace_id as string
  let environments: Record<string, unknown>[] = []
  let environmentVariables: Record<string, unknown>[] = []
  let globalVariables: Record<string, unknown>[] = []

  if (workspaceId) {
    environments = db.prepare('SELECT * FROM environments WHERE workspace_id = ?').all(workspaceId) as Record<string, unknown>[]

    const envIds = environments.map((e) => e.id as string)
    if (envIds.length > 0) {
      const placeholders = envIds.map(() => '?').join(',')
      environmentVariables = db.prepare(
        `SELECT * FROM environment_variables WHERE environment_id IN (${placeholders})`
      ).all(...envIds) as Record<string, unknown>[]
    }

    globalVariables = db.prepare('SELECT * FROM global_variables WHERE workspace_id = ?').all(workspaceId) as Record<string, unknown>[]
  }

  return {
    version: '1.0.0',
    exportedAt: Date.now(),
    project,
    folders,
    endpoints,
    endpointCases,
    savedRequests,
    environments,
    environmentVariables,
    globalVariables,
    branches,
  }
}

// ─── Import (upsert) project data into DB ────────────────────────
function importProjectData(data: ProjectExport, projectId: string): void {
  const db = getDb()

  const upsert = (table: string, rows: Record<string, unknown>[], columns: string[]): void => {
    if (rows.length === 0) return
    const placeholders = columns.map(() => '?').join(',')
    const setClause = columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')
    const stmt = db.prepare(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${setClause}`
    )
    const tx = db.transaction(() => {
      for (const row of rows) {
        const values = columns.map((c) => row[c] ?? null)
        stmt.run(...values)
      }
    })
    tx()
  }

  // Import folders
  upsert('folders', data.folders, ['id', 'project_id', 'parent_id', 'name', 'sort_order'])

  // Import endpoints
  upsert('endpoints', data.endpoints, [
    'id', 'project_id', 'folder_id', 'name', 'description', 'protocol', 'method',
    'path', 'status', 'request_schema', 'response_schemas', 'sort_order', 'created_at', 'updated_at'
  ])

  // Import endpoint cases
  if (data.endpointCases?.length) {
    upsert('endpoint_cases', data.endpointCases, [
      'id', 'endpoint_id', 'name', 'params', 'headers', 'body', 'auth', 'assertions', 'is_default', 'created_at'
    ])
  }

  // Import saved requests
  upsert('saved_requests', data.savedRequests, [
    'id', 'project_id', 'folder_id', 'name', 'protocol', 'method', 'url',
    'params', 'headers', 'body', 'auth', 'pre_script', 'post_script', 'assertions', 'metadata',
    'sort_order', 'created_at', 'updated_at'
  ])

  // Import branches
  upsert('branches', data.branches, [
    'id', 'project_id', 'name', 'parent_branch_id', 'created_at', 'is_default'
  ])

  // Import environments (workspace level)
  if (data.environments?.length) {
    upsert('environments', data.environments, [
      'id', 'workspace_id', 'name', 'is_active', 'created_at', 'updated_at'
    ])
  }

  // Import environment variables
  if (data.environmentVariables?.length) {
    upsert('environment_variables', data.environmentVariables, [
      'id', 'environment_id', 'key', 'value', 'description', 'enabled', 'secret', 'initial_value'
    ])
  }

  // Import global variables
  if (data.globalVariables?.length) {
    upsert('global_variables', data.globalVariables, [
      'id', 'workspace_id', 'key', 'value', 'description', 'enabled', 'secret', 'initial_value'
    ])
  }
}

// ─── Git helpers ─────────────────────────────────────────────────
function getSecureStore(): Promise<{ get(key: string): unknown; set(key: string, value: unknown): void }> {
  return import('electron-store').then(({ default: Store }) => {
    return new Store({
      name: 'git-credentials',
      encryptionKey: 'apinizer-secure-key-v1',
    }) as unknown as { get(key: string): unknown; set(key: string, value: unknown): void }
  })
}

function buildAuthUrl(repoUrl: string, username: string, token: string): string {
  const urlObj = new URL(repoUrl)
  urlObj.username = encodeURIComponent(username)
  urlObj.password = encodeURIComponent(token)
  return urlObj.toString()
}

function getSettingsStore(): Promise<{ get(key: string): unknown; set(key: string, value: unknown): void }> {
  return import('electron-store').then(({ default: Store }) => {
    return new Store({
      name: 'settings',
    }) as unknown as { get(key: string): unknown; set(key: string, value: unknown): void }
  })
}

async function getProjectGitConfig(projectId: string): Promise<{
  repoUrl: string; username: string; branch: string; token: string
} | null> {
  try {
    const settingsStore = await getSettingsStore()
    const gitConfig = settingsStore.get(`git`) as Record<string, {
      repoUrl?: string; username?: string; branch?: string; token?: string
    }> | undefined

    const config = gitConfig?.[projectId]
    if (!config?.repoUrl) return null

    // Token may be in config directly, or in secure store (legacy)
    let token = config.token || ''
    if (!token) {
      try {
        const secureStore = await getSecureStore()
        const b64Key = `git.${Buffer.from(config.repoUrl).toString('base64').slice(0, 32)}`
        const creds = secureStore.get(b64Key) as { token?: string } | undefined
        token = creds?.token || ''
      } catch { /* ignore */ }
    }

    return {
      repoUrl: config.repoUrl,
      username: config.username || '',
      branch: config.branch || 'main',
      token,
    }
  } catch {
    return null
  }
}

// ─── Register all handlers ───────────────────────────────────────
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

  // ─── Select JSON File ───────────────────────────────────────
  ipcMain.handle('save:selectFile', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openFile'],
        title: 'Select project file',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Cancelled' }
      }
      // Read and validate JSON
      const filePath = result.filePaths[0]
      const content = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content) as ProjectExport
      if (!data.version || !data.project) {
        return { success: false, error: 'Invalid project file format.' }
      }
      return { success: true, data: { filePath, project: data } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Import Local File ─────────────────────────────────────
  ipcMain.handle('save:importLocal', async (_event, payload: {
    filePath: string
    projectId: string
  }) => {
    try {
      const content = readFileSync(payload.filePath, 'utf-8')
      const data = JSON.parse(content) as ProjectExport
      if (!data.version || !data.project) {
        return { success: false, error: 'Invalid project file format.' }
      }
      importProjectData(data, payload.projectId)
      return {
        success: true,
        data: {
          imported: {
            folders: data.folders?.length || 0,
            endpoints: data.endpoints?.length || 0,
            savedRequests: data.savedRequests?.length || 0,
            environments: data.environments?.length || 0,
            globalVariables: data.globalVariables?.length || 0,
          },
        },
      }
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

  // ─── Git Push (manual with explicit creds) ─────────────────
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
      const authUrl = buildAuthUrl(payload.repoUrl, payload.username, payload.token)

      const tmpDir = join(tmpdir(), `apinizer-git-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()

      // Clone
      try {
        await git.clone(authUrl, tmpDir, ['--branch', payload.branch, '--single-branch', '--depth', '1'])
      } catch {
        // If branch doesn't exist, clone default and create branch
        rmSync(tmpDir, { recursive: true, force: true })
        mkdirSync(tmpDir, { recursive: true })
        await git.clone(authUrl, tmpDir, ['--depth', '1'])
        const gitRepo = simpleGit(tmpDir)
        await gitRepo.checkoutLocalBranch(payload.branch)
      }

      const gitRepo = simpleGit(tmpDir)

      // Write project JSON
      const fileName = `${projectName}.json`
      writeFileSync(join(tmpDir, fileName), JSON.stringify(data, null, 2), 'utf-8')

      // Commit and push
      await gitRepo.add(fileName)
      const status = await gitRepo.status()
      if (status.staged.length === 0 && status.modified.length === 0) {
        rmSync(tmpDir, { recursive: true, force: true })
        return { success: true, data: { repoUrl: payload.repoUrl, branch: payload.branch, message: 'No changes to push' } }
      }

      await gitRepo.commit(payload.commitMessage || `Update ${projectName}`)
      await gitRepo.push('origin', payload.branch)

      // Save credentials securely
      const store = await getSecureStore()
      store.set(`git.${Buffer.from(payload.repoUrl).toString('base64').slice(0, 32)}`, {
        repoUrl: payload.repoUrl,
        username: payload.username,
        token: payload.token,
      })

      addSaveHistory({
        project_id: payload.projectId,
        mode: 'git',
        path: `${payload.repoUrl}@${payload.branch}`,
        message: payload.commitMessage || `Update ${projectName}`,
      })

      rmSync(tmpDir, { recursive: true, force: true })

      return { success: true, data: { repoUrl: payload.repoUrl, branch: payload.branch } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Git Push (auto — uses stored creds) ───────────────────
  ipcMain.handle('save:gitPush', async (_event, payload: {
    projectId: string
    commitMessage?: string
  }) => {
    try {
      const config = await getProjectGitConfig(payload.projectId)
      if (!config || !config.repoUrl || !config.token) {
        return { success: false, error: 'Git yapılandırması bulunamadı. Proje ayarlarından Git bilgilerini girin.' }
      }

      const { simpleGit } = await import('simple-git')

      const data = exportProjectData(payload.projectId)
      const projectName = (data.project?.name as string || 'project').replace(/[^a-zA-Z0-9-_]/g, '_')
      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

      const tmpDir = join(tmpdir(), `apinizer-push-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()

      // Clone
      try {
        await git.clone(authUrl, tmpDir, ['--branch', config.branch, '--single-branch', '--depth', '1'])
      } catch {
        rmSync(tmpDir, { recursive: true, force: true })
        mkdirSync(tmpDir, { recursive: true })
        await git.clone(authUrl, tmpDir, ['--depth', '1'])
        const gitRepo = simpleGit(tmpDir)
        await gitRepo.checkoutLocalBranch(config.branch)
      }

      const gitRepo = simpleGit(tmpDir)

      // Write project JSON
      const fileName = `${projectName}.json`
      writeFileSync(join(tmpDir, fileName), JSON.stringify(data, null, 2), 'utf-8')

      // Check for changes
      await gitRepo.add(fileName)
      const status = await gitRepo.status()
      if (status.staged.length === 0) {
        rmSync(tmpDir, { recursive: true, force: true })
        return { success: true, data: { noChanges: true, message: 'Değişiklik yok — her şey güncel.' } }
      }

      const msg = payload.commitMessage || `Update ${projectName} — ${new Date().toLocaleString()}`
      await gitRepo.commit(msg)
      await gitRepo.push('origin', config.branch)

      addSaveHistory({
        project_id: payload.projectId,
        mode: 'git',
        path: `${config.repoUrl}@${config.branch}`,
        message: msg,
      })

      rmSync(tmpDir, { recursive: true, force: true })

      return { success: true, data: { repoUrl: config.repoUrl, branch: config.branch, message: msg } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Git Pull (import from git to local DB) ────────────────
  ipcMain.handle('save:gitPull', async (_event, payload: {
    projectId: string
  }) => {
    try {
      const config = await getProjectGitConfig(payload.projectId)
      if (!config || !config.repoUrl || !config.token) {
        return { success: false, error: 'Git yapılandırması bulunamadı. Proje ayarlarından Git bilgilerini girin.' }
      }

      const { simpleGit } = await import('simple-git')

      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

      const tmpDir = join(tmpdir(), `apinizer-pull-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()
      await git.clone(authUrl, tmpDir, ['--branch', config.branch, '--single-branch', '--depth', '1'])

      // Find JSON files
      const files = readdirSync(tmpDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      if (files.length === 0) {
        rmSync(tmpDir, { recursive: true, force: true })
        return { success: false, error: 'Git repository\'de proje dosyası bulunamadı.' }
      }

      // Read first (or matching) JSON file
      const content = readFileSync(join(tmpDir, files[0]), 'utf-8')
      const data = JSON.parse(content) as ProjectExport

      if (!data.version || !data.project) {
        rmSync(tmpDir, { recursive: true, force: true })
        return { success: false, error: 'Geçersiz proje dosyası formatı.' }
      }

      // Import into DB
      importProjectData(data, payload.projectId)

      addSaveHistory({
        project_id: payload.projectId,
        mode: 'git',
        path: `${config.repoUrl}@${config.branch}`,
        message: `Pull from ${config.branch}`,
      })

      rmSync(tmpDir, { recursive: true, force: true })

      return {
        success: true,
        data: {
          imported: {
            folders: data.folders?.length || 0,
            endpoints: data.endpoints?.length || 0,
            savedRequests: data.savedRequests?.length || 0,
            environments: data.environments?.length || 0,
            environmentVariables: data.environmentVariables?.length || 0,
            globalVariables: data.globalVariables?.length || 0,
          }
        }
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Store Git Token (called from renderer during project setup) ──
  ipcMain.handle('save:storeGitToken', async (_event, payload: {
    repoUrl: string
    username: string
    token: string
  }) => {
    try {
      const store = await getSecureStore()
      const b64Key = `git.${Buffer.from(payload.repoUrl).toString('base64').slice(0, 32)}`
      store.set(b64Key, {
        repoUrl: payload.repoUrl,
        username: payload.username,
        token: payload.token,
      })
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Git Config (get stored config for project) ────────────
  ipcMain.handle('save:gitConfig', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (config) {
        return { success: true, data: { repoUrl: config.repoUrl, username: config.username, branch: config.branch, hasToken: !!config.token } }
      }
      return { success: true, data: null }
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

      const authUrl = buildAuthUrl(payload.repoUrl, payload.username, payload.token)

      const tmpDir = join(tmpdir(), `apinizer-git-list-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()
      await git.clone(authUrl, tmpDir, ['--branch', payload.branch, '--single-branch', '--depth', '1'])

      const files = readdirSync(tmpDir)
        .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        .map((f) => {
          const stat = statSync(join(tmpDir, f))
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
      rmSync(tmpDir, { recursive: true, force: true })
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Stored Git Credentials ────────────────────────────────
  ipcMain.handle('save:getGitCredentials', async () => {
    try {
      const store = await getSecureStore()
      const all = store.get('git') as Record<string, unknown> | undefined
      return { success: true, data: all || {} }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Git Diff Preview ─────────────────────────────────────
  ipcMain.handle('save:gitDiff', async (_event, payload: { projectId: string; direction: 'push' | 'pull' }) => {
    try {
      const config = await getProjectGitConfig(payload.projectId)
      if (!config || !config.repoUrl || !config.token) {
        return { success: false, error: 'Git configuration not found.' }
      }

      const { simpleGit } = await import('simple-git')
      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

      const tmpDir = join(tmpdir(), `apinizer-diff-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()

      let cloned = true
      try {
        await git.clone(authUrl, tmpDir, ['--branch', config.branch, '--single-branch', '--depth', '1'])
      } catch {
        cloned = false
        rmSync(tmpDir, { recursive: true, force: true })
      }

      let remoteData: ProjectExport | null = null
      if (cloned) {
        const files = readdirSync(tmpDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        if (files.length > 0) {
          try {
            const content = readFileSync(join(tmpDir, files[0]), 'utf-8')
            remoteData = JSON.parse(content) as ProjectExport
          } catch { /* ignore */ }
        }
        rmSync(tmpDir, { recursive: true, force: true })
      }

      const localData = exportProjectData(payload.projectId)

      function diffCollection(
        local: Record<string, unknown>[],
        remote: Record<string, unknown>[],
      ) {
        const localMap = new Map(local.map((item) => [item.id as string, item]))
        const remoteMap = new Map(remote.map((item) => [item.id as string, item]))
        const details: Array<{ id: string; name: string; status: 'added' | 'removed' | 'modified' }> = []
        let added = 0, removed = 0, modified = 0

        for (const [id, item] of localMap) {
          const remoteCopy = remoteMap.get(id)
          const itemName = (item.name || item.key || item.path || id) as string
          if (!remoteCopy) { added++; details.push({ id, name: itemName, status: 'added' }) }
          else if (JSON.stringify(item) !== JSON.stringify(remoteCopy)) { modified++; details.push({ id, name: itemName, status: 'modified' }) }
        }
        for (const [id, item] of remoteMap) {
          if (!localMap.has(id)) { removed++; details.push({ id, name: (item.name || item.key || item.path || id) as string, status: 'removed' }) }
        }
        return { added, removed, modified, details }
      }

      const src = payload.direction === 'push' ? localData : (remoteData || localData)
      const empty = { endpoints: [], folders: [], savedRequests: [], environments: [], globalVariables: [] } as unknown as ProjectExport
      const tgt = payload.direction === 'push' ? (remoteData || empty) : localData

      const endpointsDiff = diffCollection(src.endpoints, tgt.endpoints)
      const foldersDiff = diffCollection(src.folders, tgt.folders)
      const savedRequestsDiff = diffCollection(src.savedRequests, tgt.savedRequests)
      const envsDiff = diffCollection(src.environments || [], tgt.environments || [])
      const globalsDiff = diffCollection(src.globalVariables || [], tgt.globalVariables || [])

      const totalChanges = endpointsDiff.added + endpointsDiff.removed + endpointsDiff.modified +
        foldersDiff.added + foldersDiff.removed + foldersDiff.modified +
        savedRequestsDiff.added + savedRequestsDiff.removed + savedRequestsDiff.modified +
        envsDiff.added + envsDiff.removed + envsDiff.modified +
        globalsDiff.added + globalsDiff.removed + globalsDiff.modified

      return {
        success: true,
        data: {
          direction: payload.direction,
          remoteExists: !!remoteData,
          totalChanges,
          changes: { endpoints: endpointsDiff, folders: foldersDiff, savedRequests: savedRequestsDiff, environments: envsDiff, globalVariables: globalsDiff },
          summary: totalChanges === 0 ? 'No changes — everything is in sync.' : `${totalChanges} change(s) detected.`,
        },
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Save History ──────────────────────────────────────────
  ipcMain.handle('save:history', async (_event, projectId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(
        'SELECT * FROM save_history WHERE project_id = ? ORDER BY timestamp DESC LIMIT 20'
      ).all(projectId)
      return { success: true, data: rows }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
