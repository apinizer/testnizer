import { useRequestStore } from '../../stores/request.store'
import MonacoWrapper from '../shared/MonacoWrapper'

export default function PreRequestTab() {
  const preScript = useRequestStore((s) => s.preScript)
  const setPreScript = useRequestStore((s) => s.setPreScript)

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <MonacoWrapper
        value={preScript}
        onChange={setPreScript}
        language="javascript"
        height={200}
      />
    </div>
  )
}
