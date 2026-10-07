import { Variable } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import McpKvSection from './McpKvSection'

/**
 * "Environment" block for a stdio server (issue #139): extra env vars for the
 * spawned process, merged over the safe default env (PATH, HOME, …) by the
 * main process. `{{var}}` resolves at Connect. Hidden for http / sse.
 */
export default function McpStdioEnvSection() {
  const { t } = useTranslation()
  const transport = useMcpStore((s) => s.transport)
  const envVars = useMcpStore((s) => s.envVars)
  const addEnvVar = useMcpStore((s) => s.addEnvVar)
  const updateEnvVar = useMcpStore((s) => s.updateEnvVar)
  const removeEnvVar = useMcpStore((s) => s.removeEnvVar)

  if (transport !== 'stdio') return null

  return (
    <McpKvSection
      testIdPrefix="mcp-env"
      title={t('mcp.env.title')}
      icon={<Variable size={14} />}
      rows={envVars}
      onUpdate={updateEnvVar}
      onRemove={removeEnvVar}
      onAdd={addEnvVar}
      addLabel={t('mcp.env.add')}
      hint={t('mcp.env.hint')}
    />
  )
}
