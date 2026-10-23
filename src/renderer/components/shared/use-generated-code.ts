import { useEffect, useMemo, useState } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useUIStore } from '../../stores/ui.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { generateCode } from '../../lib/code-generator'
import { resolveInheritance } from '../../lib/auth-inheritance'
import { activeSecretVariableNames, placeholdersIn } from '../../lib/secret-variables'
import type { AuthConfig, CodeLanguage } from '../../types'

export interface GeneratedCode {
  code: string
  /** Secret variables left as `{{name}}` because the user did not opt in. */
  hiddenSecrets: string[]
  /** `{{name}}` placeholders no active variable defines. */
  unresolved: string[]
}

/**
 * The auth the snippet shows: the request's own, or — for `inherit` — what
 * the folder chain / project resolves to, through the same
 * `resolveInheritance` Send uses (request → folder → project, `none` stops).
 * An inherited auth arrives asynchronously (folder / settings IPC); until then
 * the snippet shows no auth, never the literal `inherit`.
 */
function useEffectiveAuth(auth: AuthConfig): AuthConfig | undefined {
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const endpointId = activeTab?.endpointId
  const savedRequestId = activeTab?.savedRequestId
  const testSuiteItemId = activeTab?.testSuiteItemId
  const inherits = auth?.type === 'inherit'
  // A resolution is used only for the request it was made for: after a tab
  // switch the previous tab's credential is never shown while the new one is
  // in flight.
  const key = [projectId, endpointId, savedRequestId, testSuiteItemId].join('|')
  const [inherited, setInherited] = useState<{ key: string; auth: AuthConfig | null } | null>(null)

  useEffect(() => {
    if (!inherits) return
    let alive = true
    void resolveInheritance({
      projectId,
      endpointId,
      savedRequestId,
      testSuiteItemId,
      requestAuth: auth,
      requestPre: null,
      requestPost: null,
    }).then((r) => {
      if (alive) setInherited({ key, auth: r.auth })
    })
    return () => {
      alive = false
    }
  }, [inherits, auth, key, projectId, endpointId, savedRequestId, testSuiteItemId])

  if (!inherits) return auth?.type === 'none' ? undefined : auth
  return inherited && inherited.key === key ? (inherited.auth ?? undefined) : undefined
}

/**
 * The active request as a snippet — ONE source for both Generate Code
 * surfaces (the modal and the right panel's Code pane). Secret variables stay
 * `{{name}}` unless `includeSecrets` (`lib/secret-variables.ts`).
 */
export function useGeneratedCode(lang: CodeLanguage, includeSecrets: boolean): GeneratedCode {
  const method = useRequestStore((s) => s.method)
  const url = useRequestStore((s) => s.url)
  const params = useRequestStore((s) => s.params)
  const pathVariables = useRequestStore((s) => s.pathVariables)
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const ownAuth = useRequestStore((s) => s.auth)
  const auth = useEffectiveAuth(ownAuth)
  const sslVerification = useRequestStore((s) => s.sslVerification)
  // The cURL variant (shell + single / multi-line) — issue #279.
  const curlSnippet = useUIStore((s) => s.curlSnippet)
  const getActiveVariables = useEnvironmentStore((s) => s.getActiveVariables)
  const activeEnvironmentId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const environments = useEnvironmentStore((s) => s.environments)
  const globalVariables = useEnvironmentStore((s) => s.globalVariables)

  return useMemo(() => {
    const secretNames = activeSecretVariableNames({
      globalVariables,
      environments,
      activeEnvironmentId,
    })
    const code = generateCode(
      lang,
      { method, url, params, pathVariables, headers, body, auth, settings: { sslVerification } },
      { envVars: getActiveVariables(), secretNames, includeSecrets, curl: curlSnippet },
    )
    const left = placeholdersIn(code)
    return {
      code,
      hiddenSecrets: left.filter((n) => secretNames.has(n)),
      unresolved: left.filter((n) => !secretNames.has(n)),
    }
  }, [
    lang,
    includeSecrets,
    method,
    url,
    params,
    pathVariables,
    headers,
    body,
    auth,
    sslVerification,
    curlSnippet,
    getActiveVariables,
    activeEnvironmentId,
    environments,
    globalVariables,
  ])
}
