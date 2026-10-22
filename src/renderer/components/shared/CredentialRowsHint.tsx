import type { KeyValuePair } from '../../types'
import { isLiteralCredential } from '../../lib/credential-withhold'
import { isCredentialHeaderName } from '../../../shared/credential-headers'
import CredentialRestartHint from './CredentialRestartHint'

/**
 * Issues #244 / #247: the restart hint under a key/value editor (headers, gRPC
 * metadata, query params, form fields) — shown only while a credential-named
 * row holds a literal value, i.e. exactly when the tab snapshot leaves that
 * value out and an unsaved draft would come back without it. Same line as
 * under the Auth tab (`CredentialRestartHint`). `inset` pads it for the flush
 * tables (`KeyValueTable flush`).
 */
export default function CredentialRowsHint({
  rows,
  testId,
  isCredentialName = isCredentialHeaderName,
  isCredentialValue,
  inset = false,
}: {
  rows: readonly KeyValuePair[] | undefined
  testId: string
  isCredentialName?: (name: string) => boolean
  /** A value that is a credential whatever the name (MCP env `postgres://u:p@h`). */
  isCredentialValue?: (value: string) => boolean
  inset?: boolean
}) {
  const show = (rows ?? []).some(
    (r) =>
      r &&
      r.type !== 'file' &&
      isLiteralCredential(r.value) &&
      (isCredentialName(r.key ?? '') || !!isCredentialValue?.(r.value)),
  )
  if (!show) return null
  const hint = <CredentialRestartHint id={`${testId}-text`} testId={testId} />
  return inset ? <div className="px-2.5">{hint}</div> : hint
}
