import { useMemo, useState } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { GenerateKeyPairInput } from '../../../stores/keystore.store'
import { LabeledInput, LabeledSelect, LabeledTextarea, Modal, ModalActions } from './dialog-ui'

/**
 * Generate Key Pair dialog (design §9.5 field set). Collects the full
 * self-signed X.509v3 option set — algorithm-specific size/curve, signature
 * algorithm, subject DN, SAN, validity, serial, key usage, CA flag — and hands
 * a `GenerateKeyPairInput` to the store action.
 *
 * Faz B2 has NO per-entry password field: generated entries are protected with
 * the store password. Per-entry password protection lands in Faz B4
 * (setEntryPassword + parse-side aliasEntryPasswords threading); until then a
 * distinct entry password would make the entry undecryptable on reopen.
 *
 * Wire VALUES stay canonical (`RSA`/`EC`, `P-256`, `SHA256withRSA`,
 * `digitalSignature`, …) so localization never changes what reaches the engine
 * allow-lists; only the visible labels are translated.
 */

// Canonical allow-list values (mirror the engine — src/main/lib/keystore.ts).
const RSA_SIZES = ['1024', '2048', '3072', '4096'] as const
const EC_CURVES = ['P-256', 'P-384', 'P-521'] as const
const RSA_SIG_ALGS = ['SHA256withRSA', 'SHA384withRSA', 'SHA512withRSA'] as const
const EC_SIG_ALGS = ['SHA256withECDSA', 'SHA384withECDSA', 'SHA512withECDSA'] as const
const KEY_USAGES = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
] as const

function parseSans(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export default function GenerateKeyPairDialog({
  onSubmit,
  onClose,
  error,
}: {
  onSubmit: (opts: GenerateKeyPairInput) => Promise<boolean>
  onClose: () => void
  error: string | null
}) {
  const { t } = useTranslation()

  const [alias, setAlias] = useState('')
  const [algorithm, setAlgorithm] = useState<'RSA' | 'EC'>('RSA')
  const [keySize, setKeySize] = useState('2048')
  const [curve, setCurve] = useState('P-256')
  const [sigAlg, setSigAlg] = useState('SHA256withRSA')
  const [subjectDN, setSubjectDN] = useState('')
  const [san, setSan] = useState('')
  const [validityDays, setValidityDays] = useState('365')
  const [serialNumber, setSerialNumber] = useState('')
  const [keyUsage, setKeyUsage] = useState<string[]>([])
  const [basicConstraintsCa, setBasicConstraintsCa] = useState(false)
  const [busy, setBusy] = useState(false)

  const sigOptions = algorithm === 'RSA' ? RSA_SIG_ALGS : EC_SIG_ALGS

  // Signature algorithm default follows the selected key algorithm.
  function changeAlgorithm(next: string): void {
    const algo = next === 'EC' ? 'EC' : 'RSA'
    setAlgorithm(algo)
    setSigAlg(algo === 'RSA' ? 'SHA256withRSA' : 'SHA256withECDSA')
  }

  function toggleUsage(value: string): void {
    setKeyUsage((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  /**
   * A certificate whose validity is zero or negative days is expired the moment
   * it is minted. The field accepted it silently.
   */
  const validityWarning: string | null = (() => {
    const raw = validityDays.trim()
    if (!raw) return null
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 1) return t('tools.keystore.generate.validityTooSmall')
    return null
  })()

  const canSubmit = useMemo(
    () => alias.trim().length > 0 && !busy && validityWarning === null,
    [alias, busy, validityWarning],
  )

  async function submit(): Promise<void> {
    if (!canSubmit) return
    setBusy(true)
    const days = Number.parseInt(validityDays, 10)
    const opts: GenerateKeyPairInput = {
      alias: alias.trim(),
      keyAlgorithm: algorithm,
      signatureAlgorithm: sigAlg,
      basicConstraintsCa,
      ...(algorithm === 'RSA' ? { keySize: Number.parseInt(keySize, 10) } : { curve }),
      ...(subjectDN.trim() ? { subjectDN: subjectDN.trim() } : {}),
      ...(parseSans(san).length ? { subjectAlternativeNames: parseSans(san) } : {}),
      ...(Number.isFinite(days) ? { validityDays: days } : {}),
      ...(serialNumber.trim() ? { serialNumber: serialNumber.trim() } : {}),
      ...(keyUsage.length ? { keyUsage } : {}),
    }
    const ok = await onSubmit(opts)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={t('tools.keystore.generate.keyPairTitle')} onClose={onClose} wide>
      <LabeledInput
        label={t('tools.keystore.generate.alias')}
        value={alias}
        autoFocus
        onChange={setAlias}
      />

      <div className="grid grid-cols-2 gap-3">
        <LabeledSelect
          label={t('tools.keystore.generate.algorithm')}
          value={algorithm}
          onChange={changeAlgorithm}
          options={[
            ['RSA', t('tools.keystore.generate.algo.RSA')],
            ['EC', t('tools.keystore.generate.algo.EC')],
          ]}
        />
        {algorithm === 'RSA' ? (
          <LabeledSelect
            label={t('tools.keystore.generate.keySize')}
            value={keySize}
            onChange={setKeySize}
            options={RSA_SIZES.map((s) => [s, `${s} ${t('tools.keystore.bits')}`])}
          />
        ) : (
          <LabeledSelect
            label={t('tools.keystore.generate.curve')}
            value={curve}
            onChange={setCurve}
            options={EC_CURVES.map((c) => [c, c])}
          />
        )}
      </div>

      <LabeledSelect
        label={t('tools.keystore.generate.signatureAlgorithm')}
        value={sigAlg}
        onChange={setSigAlg}
        options={sigOptions.map((a) => [a, a])}
      />

      <LabeledInput
        label={t('tools.keystore.generate.subjectDN')}
        value={subjectDN}
        placeholder={`CN=${alias.trim() || 'alias'}`}
        onChange={setSubjectDN}
      />

      <LabeledTextarea
        label={t('tools.keystore.generate.san')}
        value={san}
        placeholder={t('tools.keystore.generate.sanHint')}
        onChange={setSan}
        rows={2}
      />

      <div className="grid grid-cols-2 gap-3">
        <LabeledInput
          label={t('tools.keystore.generate.validityDays')}
          type="number"
          value={validityDays}
          onChange={setValidityDays}
        />
        {validityWarning && (
          <p role="alert" className="col-span-2 -mt-2 text-[11px]" style={{ color: '#cc2200' }}>
            {validityWarning}
          </p>
        )}
        <LabeledInput
          label={t('tools.keystore.generate.serialNumber')}
          value={serialNumber}
          placeholder={t('tools.keystore.generate.serialHint')}
          onChange={setSerialNumber}
        />
      </div>

      <div>
        <span
          className="mb-1 block text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--muted)' }}
        >
          {t('tools.keystore.generate.keyUsage')}
        </span>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {KEY_USAGES.map((u) => (
            <label
              key={u}
              className="flex items-center gap-1.5 text-[11px]"
              style={{ color: 'var(--text)' }}
            >
              <input
                type="checkbox"
                checked={keyUsage.includes(u)}
                onChange={() => toggleUsage(u)}
              />
              {t(`tools.keystore.generate.ku.${u}`)}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text)' }}>
        <input
          type="checkbox"
          checked={basicConstraintsCa}
          onChange={(e) => setBasicConstraintsCa(e.target.checked)}
        />
        {t('tools.keystore.generate.basicConstraintsCa')}
      </label>
      {basicConstraintsCa && !keyUsage.includes('keyCertSign') && (
        <p className="text-[11px]" style={{ color: 'var(--orange, #b35a00)' }}>
          {t('tools.keystore.generate.caNeedsKeyCertSign')}
        </p>
      )}

      {/* No entry-password field in Faz B2 — generated entries are protected
          with the store password; per-entry passwords land in Faz B4. */}

      {error && (
        <p className="text-[11px]" style={{ color: '#cc2200' }}>
          {error}
        </p>
      )}

      <ModalActions
        onCancel={onClose}
        confirmLabel={t('tools.keystore.generate.submit')}
        onConfirm={() => void submit()}
        confirmDisabled={!canSubmit}
      />
    </Modal>
  )
}
