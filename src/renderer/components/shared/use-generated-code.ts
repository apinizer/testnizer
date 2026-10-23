import { useMemo } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useUIStore } from '../../stores/ui.store'
import { generateCode } from '../../lib/code-generator'
import { activeSecretVariableNames, placeholdersIn } from '../../lib/secret-variables'
import type { CodeLanguage } from '../../types'

export interface GeneratedCode {
  code: string
  /** Secret variables left as `{{name}}` because the user did not opt in. */
  hiddenSecrets: string[]
  /** `{{name}}` placeholders no active variable defines. */
  unresolved: string[]
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
  const headers = useRequestStore((s) => s.headers)
  const body = useRequestStore((s) => s.body)
  const auth = useRequestStore((s) => s.auth)
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
      { method, url, params, headers, body, auth, settings: { sslVerification } },
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
