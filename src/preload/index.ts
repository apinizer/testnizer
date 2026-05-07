import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // ─── Auth ───────────────────────────────────────────────
  auth: {
    hasPassword: (): Promise<unknown> => ipcRenderer.invoke('auth:hasPassword'),
    setPassword: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('auth:setPassword', payload),
    login: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('auth:login', payload),
    getSession: (token: string): Promise<unknown> => ipcRenderer.invoke('auth:getSession', token),
    logout: (token: string): Promise<unknown> => ipcRenderer.invoke('auth:logout', token),
    changePassword: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('auth:changePassword', payload),
    disablePassword: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('auth:disablePassword', payload),
    recoverPassword: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('auth:recoverPassword', payload),
    listUsers: (): Promise<unknown> => ipcRenderer.invoke('auth:listUsers'),
  },

  // ─── Window ─────────────────────────────────────────────
  window: {
    toggleMaximize: (): Promise<unknown> => ipcRenderer.invoke('window:toggleMaximize'),
  },

  // ─── App ────────────────────────────────────────────────
  app: {
    version: (): Promise<unknown> => ipcRenderer.invoke('app:version'),
    openExternal: (url: string): Promise<unknown> => ipcRenderer.invoke('app:openExternal', url),
  },

  // ─── Dialog ─────────────────────────────────────────────
  dialog: {
    openFile: (options?: {
      title?: string
      filters?: Array<{ name: string; extensions: string[] }>
      multiSelections?: boolean
    }): Promise<unknown> => ipcRenderer.invoke('dialog:openFile', options ?? {}),
  },

  // ─── Request ─────────────────────────────────────────────
  request: {
    send: (options: unknown): Promise<unknown> => ipcRenderer.invoke('request:send', options),
    cancel: (requestId: string): Promise<unknown> =>
      ipcRenderer.invoke('request:cancel', requestId),
  },

  // ─── Workspace ───────────────────────────────────────────
  workspace: {
    list: (): Promise<unknown> => ipcRenderer.invoke('workspace:list'),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('workspace:get', id),
    create: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('workspace:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('workspace:update', id, payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('workspace:delete', id),
  },

  // ─── Project ─────────────────────────────────────────────
  project: {
    list: (workspaceId: string): Promise<unknown> =>
      ipcRenderer.invoke('project:list', workspaceId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('project:get', id),
    create: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('project:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('project:update', id, payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('project:delete', id),
  },

  // ─── Folder ──────────────────────────────────────────────
  folder: {
    list: (projectId: string): Promise<unknown> => ipcRenderer.invoke('folder:list', projectId),
    create: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('folder:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('folder:update', id, payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('folder:delete', id),
  },

  // ─── Endpoint ────────────────────────────────────────────
  endpoint: {
    listByProject: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('endpoint:listByProject', projectId),
    listByFolder: (folderId: string): Promise<unknown> =>
      ipcRenderer.invoke('endpoint:listByFolder', folderId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('endpoint:get', id),
    create: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('endpoint:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('endpoint:update', id, payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('endpoint:delete', id),
  },

  // ─── Endpoint Cases ──────────────────────────────────────
  endpointCase: {
    list: (endpointId: string): Promise<unknown> =>
      ipcRenderer.invoke('endpointCase:list', endpointId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('endpointCase:get', id),
    create: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('endpointCase:create', payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('endpointCase:delete', id),
  },

  // ─── Saved Requests ──────────────────────────────────────
  savedRequest: {
    list: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('savedRequest:list', projectId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('savedRequest:get', id),
    create: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('savedRequest:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('savedRequest:update', id, payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('savedRequest:delete', id),
  },

  // ─── Environment ─────────────────────────────────────────
  environment: {
    list: (workspaceId: string): Promise<unknown> =>
      ipcRenderer.invoke('environment:list', workspaceId),
    listByProject: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('environment:listByProject', projectId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('environment:get', id),
    create: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('environment:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('environment:update', id, payload),
    setActive: (workspaceId: string, environmentId: string): Promise<unknown> =>
      ipcRenderer.invoke('environment:setActive', workspaceId, environmentId),
    setActiveForProject: (projectId: string, environmentId: string): Promise<unknown> =>
      ipcRenderer.invoke('environment:setActiveForProject', projectId, environmentId),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('environment:delete', id),
  },

  // ─── Environment Variables ───────────────────────────────
  envVariable: {
    list: (environmentId: string): Promise<unknown> =>
      ipcRenderer.invoke('envVariable:list', environmentId),
    create: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('envVariable:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('envVariable:update', id, payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('envVariable:delete', id),
  },

  // ─── Global Variables ────────────────────────────────────
  globalVariable: {
    list: (workspaceId: string): Promise<unknown> =>
      ipcRenderer.invoke('globalVariable:list', workspaceId),
    listByProject: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('globalVariable:listByProject', projectId),
    create: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('globalVariable:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('globalVariable:update', id, payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('globalVariable:delete', id),
  },

  // ─── History ─────────────────────────────────────────────
  history: {
    list: (options: unknown): Promise<unknown> => ipcRenderer.invoke('history:list', options),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('history:get', id),
    add: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('history:add', payload),
    clear: (scope?: string | { workspace_id?: string; project_id?: string }): Promise<unknown> =>
      ipcRenderer.invoke('history:clear', scope),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('history:delete', id),
    prune: (limit: number, workspaceId?: string): Promise<unknown> =>
      ipcRenderer.invoke('history:prune', limit, workspaceId),
  },

  // ─── Settings ────────────────────────────────────────────
  settings: {
    getAll: (): Promise<unknown> => ipcRenderer.invoke('settings:getAll'),
    get: (key: string): Promise<unknown> => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown): Promise<unknown> =>
      ipcRenderer.invoke('settings:set', key, value),
    setAll: (settings: unknown): Promise<unknown> =>
      ipcRenderer.invoke('settings:setAll', settings),
    reset: (): Promise<unknown> => ipcRenderer.invoke('settings:reset'),
  },

  // ─── Import/Export ───────────────────────────────────────
  importExport: {
    fetchUrl: (url: string): Promise<unknown> => ipcRenderer.invoke('import:fetchUrl', url),
    openFile: (): Promise<unknown> => ipcRenderer.invoke('import:openFile'),
    importOpenApi: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('import:openApi', payload),
    exportOpenApi: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('export:openApi', projectId),
    saveFile: (content: string, defaultName: string): Promise<unknown> =>
      ipcRenderer.invoke('export:saveFile', content, defaultName),
    importPostman: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('import:postman', payload),
    exportPostman: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('export:postman', projectId),
    importHar: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('import:har', payload),
    importInsomnia: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('import:insomnia', payload),
    exportInsomnia: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('export:insomnia', projectId),
    importCurl: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('import:curl', payload),
    exportCurl: (request: unknown): Promise<unknown> => ipcRenderer.invoke('export:curl', request),
    importWsdl: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('import:wsdl', payload),
    importSoapUi: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('import:soapui', payload),
    importRaml: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('import:raml', payload),
    importProto: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('import:proto', payload),
    parseWsdlForImport: (url: string): Promise<unknown> =>
      ipcRenderer.invoke('import:wsdl:parse', url),
    parseWsdlFileForImport: (content: string): Promise<unknown> =>
      ipcRenderer.invoke('import:wsdl:parseFile', content),
  },

  // ─── SOAP ─────────────────────────────────────────────────
  soap: {
    parseWsdl: (url: string): Promise<unknown> => ipcRenderer.invoke('wsdl:parse', url),
    parseWsdlFile: (content: string): Promise<unknown> =>
      ipcRenderer.invoke('wsdl:parseFile', content),
    execute: (options: unknown): Promise<unknown> => ipcRenderer.invoke('soap:execute', options),
    generateEnvelope: (options: unknown): Promise<unknown> =>
      ipcRenderer.invoke('soap:generateEnvelope', options),
  },

  // ─── WS-Security ──────────────────────────────────────────
  wsse: {
    apply: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('wsse:apply', payload),
    verify: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('wsse:verify', payload),
    decrypt: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('wsse:decrypt', payload),
  },

  // ─── Diagnostics ──────────────────────────────────────────
  diagnostics: {
    export: (): Promise<unknown> => ipcRenderer.invoke('diagnostics:export'),
    revealLogs: (): Promise<unknown> => ipcRenderer.invoke('diagnostics:reveal'),
    thirdPartyLicenses: (): Promise<unknown> =>
      ipcRenderer.invoke('diagnostics:thirdPartyLicenses'),
  },

  // ─── WebSocket ────────────────────────────────────────────
  ws: {
    connect: (options: unknown): Promise<unknown> => ipcRenderer.invoke('ws:connect', options),
    disconnect: (connectionId: string): Promise<unknown> =>
      ipcRenderer.invoke('ws:disconnect', connectionId),
    send: (connectionId: string, message: string): Promise<unknown> =>
      ipcRenderer.invoke('ws:send', connectionId, message),
    onEvent: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('ws:event', handler)
      return () => {
        ipcRenderer.removeListener('ws:event', handler)
      }
    },
  },

  // ─── Collection Runner ──────────────────────────────────────
  runner: {
    execute: (options: unknown): Promise<unknown> => ipcRenderer.invoke('runner:execute', options),
    stop: (): Promise<unknown> => ipcRenderer.invoke('runner:stop'),
    export: (options: unknown): Promise<unknown> => ipcRenderer.invoke('runner:export', options),
    onProgress: (callback: (progress: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('runner:progress', handler)
      return () => {
        ipcRenderer.removeListener('runner:progress', handler)
      }
    },
    history: (
      arg:
        | string
        | { projectId: string; limit?: number; offset?: number; tab?: 'Functional' | 'Scheduled' },
    ): Promise<unknown> => ipcRenderer.invoke('runner:history', arg),
    historyStats: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('runner:historyStats', projectId),
    deleteHistory: (ids: string | string[]): Promise<unknown> =>
      ipcRenderer.invoke('runner:deleteHistory', ids),
  },

  // ─── Scheduler ──────────────────────────────────────────────────
  scheduler: {
    create: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('scheduler:create', payload),
    list: (projectId: string): Promise<unknown> => ipcRenderer.invoke('scheduler:list', projectId),
    delete: (taskId: string): Promise<unknown> => ipcRenderer.invoke('scheduler:delete', taskId),
    toggle: (taskId: string): Promise<unknown> => ipcRenderer.invoke('scheduler:toggle', taskId),
    onRunCompleted: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('scheduler:runCompleted', handler)
      return () => {
        ipcRenderer.removeListener('scheduler:runCompleted', handler)
      }
    },
  },

  // ─── Test Suites ──────────────────────────────────────────────
  testSuite: {
    list: (projectId: string): Promise<unknown> => ipcRenderer.invoke('testSuite:list', projectId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('testSuite:get', id),
    create: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('testSuite:create', payload),
    update: (id: string, payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('testSuite:update', id, payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('testSuite:delete', id),
    listEndpoints: (suiteId: string): Promise<unknown> =>
      ipcRenderer.invoke('testSuite:listEndpoints', suiteId),
    addEndpoints: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('testSuite:addEndpoints', payload),
    removeEndpoint: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('testSuite:removeEndpoint', payload),
  },

  // ─── Certificates ───────────────────────────────────────────
  certificate: {
    list: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('certificate:list', projectId),
    add: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('certificate:add', payload),
    update: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('certificate:update', payload),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('certificate:delete', id),
    pickFile: (kind: 'crt' | 'key' | 'pfx' | 'ca'): Promise<unknown> =>
      ipcRenderer.invoke('certificate:pickFile', kind),
  },

  // ─── GraphQL ────────────────────────────────────────────────
  graphql: {
    execute: (options: unknown): Promise<unknown> => ipcRenderer.invoke('graphql:execute', options),
    introspect: (url: string, headers?: unknown): Promise<unknown> =>
      ipcRenderer.invoke('graphql:introspect', { url, headers }),
    subscribe: (options: unknown): Promise<unknown> =>
      ipcRenderer.invoke('graphql:subscribe', options),
    unsubscribe: (subscriptionId: string): Promise<unknown> =>
      ipcRenderer.invoke('graphql:unsubscribe', subscriptionId),
    onSubscriptionEvent: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('graphql:subscriptionEvent', handler)
      return () => {
        ipcRenderer.removeListener('graphql:subscriptionEvent', handler)
      }
    },
  },

  // ─── gRPC ───────────────────────────────────────────────────
  grpc: {
    loadProto: (): Promise<unknown> => ipcRenderer.invoke('grpc:loadProto'),
    execute: (options: unknown): Promise<unknown> => ipcRenderer.invoke('grpc:execute', options),
    serverStream: (options: unknown): Promise<unknown> =>
      ipcRenderer.invoke('grpc:serverStream', options),
    reflect: (address: string, useTls?: boolean): Promise<unknown> =>
      ipcRenderer.invoke('grpc:reflect', { address, useTls }),
    clientStream: (options: unknown): Promise<unknown> =>
      ipcRenderer.invoke('grpc:clientStream', options),
    bidiStream: (options: unknown): Promise<unknown> =>
      ipcRenderer.invoke('grpc:bidiStream', options),
    sendStreamMessage: (streamId: string, message: unknown): Promise<unknown> =>
      ipcRenderer.invoke('grpc:sendStreamMessage', streamId, message),
    endStream: (streamId: string): Promise<unknown> =>
      ipcRenderer.invoke('grpc:endStream', streamId),
    cancelStream: (streamId: string): Promise<unknown> =>
      ipcRenderer.invoke('grpc:cancelStream', streamId),
    onStreamEvent: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('grpc:streamEvent', handler)
      return () => {
        ipcRenderer.removeListener('grpc:streamEvent', handler)
      }
    },
  },

  // ─── Updater ─────────────────────────────────────────────────
  updater: {
    check: (): Promise<unknown> => ipcRenderer.invoke('updater:check'),
    download: (): Promise<unknown> => ipcRenderer.invoke('updater:download'),
    install: (): Promise<unknown> => ipcRenderer.invoke('updater:install'),
    onEvent: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('updater:event', handler)
      return () => {
        ipcRenderer.removeListener('updater:event', handler)
      }
    },
  },

  // ─── Branch (legacy DB branches) ────────────────────────────
  branch: {
    list: (projectId: string): Promise<unknown> => ipcRenderer.invoke('branch:list', projectId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('branch:get', id),
    create: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('branch:create', payload),
    rename: (id: string, name: string): Promise<unknown> =>
      ipcRenderer.invoke('branch:rename', id, name),
    delete: (id: string): Promise<unknown> => ipcRenderer.invoke('branch:delete', id),
    ensureDefault: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('branch:ensureDefault', projectId),
  },

  // ─── Git (real Git operations) ────────────────────────────
  git: {
    hasConfig: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('git:hasConfig', projectId),
    listBranches: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('git:listBranches', projectId),
    currentBranch: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('git:currentBranch', projectId),
    createBranch: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('git:createBranch', payload),
    switchBranch: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('git:switchBranch', payload),
    merge: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('git:merge', payload),
    push: (projectId: string): Promise<unknown> => ipcRenderer.invoke('git:push', projectId),
    pull: (projectId: string): Promise<unknown> => ipcRenderer.invoke('git:pull', projectId),
    status: (projectId: string): Promise<unknown> => ipcRenderer.invoke('git:status', projectId),
    deleteBranch: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('git:deleteBranch', payload),
    log: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('git:log', payload),
  },

  // ─── Save ───────────────────────────────────────────────────
  save: {
    local: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('save:local', payload),
    selectFile: (): Promise<unknown> => ipcRenderer.invoke('save:selectFile'),
    importLocal: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('save:importLocal', payload),
    selectDirectory: (): Promise<unknown> => ipcRenderer.invoke('save:selectDirectory'),
    git: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('save:git', payload),
    storeGitToken: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('save:storeGitToken', payload),
    gitPush: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('save:gitPush', payload),
    gitPull: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('save:gitPull', payload),
    gitConfig: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('save:gitConfig', projectId),
    gitListFiles: (payload: unknown): Promise<unknown> =>
      ipcRenderer.invoke('save:gitListFiles', payload),
    gitReadFile: (filePath: string): Promise<unknown> =>
      ipcRenderer.invoke('save:gitReadFile', filePath),
    gitCleanup: (tmpDir: string): Promise<unknown> => ipcRenderer.invoke('save:gitCleanup', tmpDir),
    getGitCredentials: (): Promise<unknown> => ipcRenderer.invoke('save:getGitCredentials'),
    gitDiff: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('save:gitDiff', payload),
    history: (projectId: string): Promise<unknown> => ipcRenderer.invoke('save:history', projectId),
    exportProject: (projectId: string): Promise<unknown> =>
      ipcRenderer.invoke('save:exportProject', projectId),
    exportFolder: (folderId: string): Promise<unknown> =>
      ipcRenderer.invoke('save:exportFolder', folderId),
    exportTestSuite: (suiteId: string): Promise<unknown> =>
      ipcRenderer.invoke('save:exportTestSuite', suiteId),
    importProject: (payload: { workspaceId: string; name?: string }): Promise<unknown> =>
      ipcRenderer.invoke('save:importProject', payload),
    importFolder: (payload: {
      projectId: string
      parentFolderId?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('save:importFolder', payload),
    importTestSuite: (payload: {
      projectId: string
      content?: string
      suiteName?: string
    }): Promise<unknown> => ipcRenderer.invoke('save:importTestSuite', payload),
  },

  // ─── Console logs (Postman-style) ───────────────────────────
  console: {
    /**
     * Subscribe to streaming console log entries from main process.
     * Returns a teardown function that removes the listener.
     */
    onLog: (callback: (entry: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('console:log', handler)
      return () => {
        ipcRenderer.removeListener('console:log', handler)
      }
    },
  },

  // ─── SSE ────────────────────────────────────────────────────
  sse: {
    connect: (options: unknown): Promise<unknown> => ipcRenderer.invoke('sse:connect', options),
    disconnect: (connectionId: string): Promise<unknown> =>
      ipcRenderer.invoke('sse:disconnect', connectionId),
    onEvent: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('sse:event', handler)
      return () => {
        ipcRenderer.removeListener('sse:event', handler)
      }
    },
  },

  // ─── AI Chat ────────────────────────────────────────────────
  aiChat: {
    send: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('aichat:send', payload),
    cancel: (messageId: string): Promise<unknown> =>
      ipcRenderer.invoke('aichat:cancel', messageId),
    onChunk: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('aichat:chunk', handler)
      return () => {
        ipcRenderer.removeListener('aichat:chunk', handler)
      }
    },
    onDone: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('aichat:done', handler)
      return () => {
        ipcRenderer.removeListener('aichat:done', handler)
      }
    },
    onError: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('aichat:error', handler)
      return () => {
        ipcRenderer.removeListener('aichat:error', handler)
      }
    },
    onCancelled: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
        callback(data)
      }
      ipcRenderer.on('aichat:cancelled', handler)
      return () => {
        ipcRenderer.removeListener('aichat:cancelled', handler)
      }
    },
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error fallback for non-isolated context
  window.electron = electronAPI
  // @ts-expect-error fallback
  window.api = api
}
