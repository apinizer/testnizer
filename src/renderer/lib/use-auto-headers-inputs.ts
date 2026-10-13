/**
 * Inputs of the Headers tab's auto-generated section (issue #204) that need
 * IPC: the app version (User-Agent) and the effective — possibly inherited —
 * auth. IPC reads only; the renderer makes no network call here.
 */
import { useEffect, useState } from 'react'
import { useTabsStore } from '../stores/tabs.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { resolveInheritance } from './auth-inheritance'
import type { AuthConfig } from '../types'

// App version for the User-Agent row — read once per session over IPC.
let cachedVersion: string | null = null

const INHERIT_DEBOUNCE_MS = 300

export function useAppVersion(): string | undefined {
  const [version, setVersion] = useState<string | undefined>(cachedVersion ?? undefined)
  useEffect(() => {
    if (cachedVersion) return
    let alive = true
    void (async () => {
      try {
        const r = (await window.api?.app?.version?.()) as
          | { success: boolean; data?: { version?: string } }
          | undefined
        const v = r?.success ? r.data?.version : undefined
        if (v && v !== 'unknown') {
          cachedVersion = v
          if (alive) setVersion(v)
        }
      } catch {
        /* User-Agent stays a send-time row */
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  return version
}

/** Effective auth: the request's own, or the inherited folder/project auth. */
export function useEffectiveAuth(auth: AuthConfig): AuthConfig | null {
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const endpointId = activeTab?.endpointId
  const savedRequestId = activeTab?.savedRequestId
  const [inherited, setInherited] = useState<AuthConfig | null>(null)
  const isInherit = auth.type === 'inherit'

  useEffect(() => {
    if (!isInherit) return
    let alive = true
    const timer = setTimeout(() => {
      void resolveInheritance({
        projectId,
        endpointId,
        savedRequestId,
        requestAuth: auth,
        requestPre: null,
        requestPost: null,
      })
        .then((r) => {
          if (alive) setInherited(r.auth)
        })
        .catch(() => {
          if (alive) setInherited(null)
        })
    }, INHERIT_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [isInherit, auth, projectId, endpointId, savedRequestId])

  if (!isInherit) return auth.type === 'none' ? null : auth
  return inherited
}
