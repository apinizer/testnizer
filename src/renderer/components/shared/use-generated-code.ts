import { useMemo } from 'react'
import { useEnvironmentStore } from '../../stores/environment.store'
import { generateSnippet } from '../../lib/code-generator'
import { activeSecretVariableNames, placeholdersIn } from '../../lib/secret-variables'
import type { CodegenOptions } from '../../../shared/codegen'
import { useCodegenSource } from './use-codegen-source'

export interface GeneratedCode {
  code: string
  /** Secret variables left as `{{name}}` because the user did not opt in. */
  hiddenSecrets: string[]
  /** `{{name}}` placeholders no active variable defines. */
  unresolved: string[]
  /** Set when the active tab's protocol has no HTTP snippet (WebSocket, MCP…). */
  unavailableProtocol?: string
}

/**
 * The active request as a snippet — ONE source for both Generate Code
 * surfaces (the modal and the right panel's Code pane). The request comes
 * from the active protocol (`useCodegenSource`: HTTP, GraphQL, SOAP). Secret
 * variables stay `{{name}}` unless `includeSecrets` (`lib/secret-variables.ts`).
 */
export function useGeneratedCode(
  variantId: string,
  includeSecrets: boolean,
  variantOptions?: CodegenOptions,
): GeneratedCode {
  const source = useCodegenSource()
  const req = source.kind === 'request' ? source.req : undefined
  const unavailableProtocol = source.kind === 'unavailable' ? source.protocol : undefined
  const getActiveVariables = useEnvironmentStore((s) => s.getActiveVariables)
  const activeEnvironmentId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const environments = useEnvironmentStore((s) => s.environments)
  const globalVariables = useEnvironmentStore((s) => s.globalVariables)

  return useMemo(() => {
    if (!req) return { code: '', hiddenSecrets: [], unresolved: [], unavailableProtocol }
    const secretNames = activeSecretVariableNames({
      globalVariables,
      environments,
      activeEnvironmentId,
    })
    const code = generateSnippet(variantId, req, {
      envVars: getActiveVariables(),
      secretNames,
      includeSecrets,
      variantOptions,
    })
    const left = placeholdersIn(code)
    return {
      code,
      hiddenSecrets: left.filter((n) => secretNames.has(n)),
      unresolved: left.filter((n) => !secretNames.has(n)),
    }
  }, [
    req,
    unavailableProtocol,
    variantId,
    includeSecrets,
    variantOptions,
    getActiveVariables,
    activeEnvironmentId,
    environments,
    globalVariables,
  ])
}
