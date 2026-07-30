import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import BuildForm from './saml/BuildForm'
import SignForm from './saml/SignForm'
import VerifyForm from './saml/VerifyForm'
import BindingForm from './saml/BindingForm'
import VerifyReport from './saml/VerifyReport'
import { useTranslation } from '../../lib/i18n'
import {
  SAML_MODES,
  buildKeyInput,
  buildRequestFromForm,
  buildSaml,
  decodeSaml,
  emptyBindingForm,
  emptyBuildForm,
  emptySignForm,
  emptyVerifyForm,
  encodeSaml,
  signSamlDocument,
  verifyOptionsFromForm,
  verifySamlDocument,
  type SamlToolMode,
} from '../../lib/tools/saml'
import type { SamlVerifyResult } from '../../types'

/**
 * Tools → SAML (#65, Faz E).
 *
 * Build / Sign / Verify / Encode-Decode. Every operation runs in MAIN
 * (`saml:*` IPC → `protocols/saml.engine.ts`): the renderer has no
 * `xml-crypto`, and — more importantly — a keystore-backed private key must
 * never be handed to it.
 *
 * ADDITIVE: the pasted Certificate / Private Key PEM textareas are the DEFAULT
 * and only mandatory path. "Use from keystore / Security" is ONE optional arm;
 * untouched, the IPC payload is exactly the inline shape.
 */
export default function SamlTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<SamlToolMode>('build')
  const [xml, setXml] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [verifyResult, setVerifyResult] = useState<SamlVerifyResult | null>(null)

  const [buildForm, setBuildForm] = useState(emptyBuildForm)
  const [signForm, setSignForm] = useState(emptySignForm)
  const [verifyForm, setVerifyForm] = useState(emptyVerifyForm)
  const [bindingForm, setBindingForm] = useState(emptyBindingForm)

  function reset(): void {
    setError(null)
    setStatus(null)
    setVerifyResult(null)
  }

  /**
   * Drop the verdict because the USER changed what it was a verdict about.
   *
   * Verify a signed assertion, get the green "Valid" report, then edit one
   * character of the XML: the report used to stay on screen, now describing a
   * document that no longer exists. For a signature checker that is the worst
   * possible failure mode — it answers "is this trustworthy?" about the wrong
   * input.
   *
   * Deliberately called from the change handlers rather than from an effect on
   * `xml`: `run()` writes `xml` itself (a built or signed document lands in the
   * editor), so an effect would also wipe the "Signed" status the action had
   * just set.
   */
  function invalidateVerdict(): void {
    setStatus(null)
    setVerifyResult(null)
    // The encoded blob is derived from the XML too, so it is stale as well.
    setBindingForm((prev) => (prev.encoded ? { ...prev, encoded: '' } : prev))
  }

  async function run(): Promise<void> {
    reset()
    try {
      if (mode === 'build') {
        const doc = await buildSaml(buildRequestFromForm(buildForm, xml))
        setOutput(doc.xml)
        // The built document becomes the editor content so Sign / Verify can
        // act on it immediately ("paste XML or use the built one").
        setXml(doc.xml)
        setStatus(t('tools.saml.built').replace('{id}', doc.id))
      } else if (mode === 'sign') {
        const signed = await signSamlDocument({
          xml,
          algorithm: signForm.algorithm,
          signatureTarget: signForm.signatureTarget,
          key: buildKeyInput(signForm),
        })
        setOutput(signed)
        setXml(signed)
        setStatus(t('tools.saml.signed'))
      } else if (mode === 'verify') {
        const result = await verifySamlDocument({
          xml,
          // Verification needs only the trust anchor — no private half is ever
          // materialised for this call.
          key: buildKeyInput({ certPem: verifyForm.certPem, keySource: verifyForm.keySource }),
          options: verifyOptionsFromForm(verifyForm),
        })
        setVerifyResult(result)
        setOutput('')
        setStatus(result.valid ? t('tools.saml.valid') : t('tools.saml.rejected'))
      }
    } catch (e) {
      setOutput('')
      setVerifyResult(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function encode(): Promise<void> {
    reset()
    try {
      const value = await encodeSaml({
        xml,
        binding: bindingForm.binding,
        urlEncode: bindingForm.urlEncode,
      })
      setBindingForm({ ...bindingForm, encoded: value })
      setOutput(value)
      setStatus(t('tools.saml.encoded'))
    } catch (e) {
      setOutput('')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function decode(): Promise<void> {
    reset()
    try {
      const decoded = await decodeSaml({
        value: bindingForm.encoded,
        binding: bindingForm.binding,
      })
      setXml(decoded)
      setOutput(decoded)
      setStatus(t('tools.saml.decoded'))
    } catch (e) {
      setOutput('')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toolbar = (
    <>
      {mode === 'binding' ? (
        <>
          <button
            onClick={() => void encode()}
            className="cursor-pointer rounded px-3 py-1 text-xs font-medium"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {t('tools.saml.action.encode')}
          </button>
          <button
            onClick={() => void decode()}
            className="cursor-pointer rounded border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            {t('tools.saml.action.decode')}
          </button>
        </>
      ) : (
        <button
          onClick={() => void run()}
          className="cursor-pointer rounded px-3 py-1 text-xs font-medium"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          {t(`tools.saml.action.${mode}`)}
        </button>
      )}
      <button
        onClick={() => {
          setXml('')
          setOutput('')
          reset()
        }}
        className="cursor-pointer rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        {t('tools.common.clear')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.saml.title')}
      toolbar={toolbar}
      footer={status}
      outputLabel={mode === 'verify' ? t('tools.saml.report') : undefined}
      inputPane={
        <div className="flex h-full flex-col">
          <div
            className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 h-8"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {SAML_MODES.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m)
                  reset()
                }}
                className="cursor-pointer rounded px-2.5 py-0.5 text-xs font-medium transition-colors"
                style={{
                  background: mode === m ? 'var(--accent-light)' : 'transparent',
                  color: mode === m ? 'var(--accent-text)' : 'var(--muted)',
                }}
              >
                {t(`tools.saml.mode.${m}`)}
              </button>
            ))}
          </div>

          <div className="shrink-0 overflow-auto" style={{ maxHeight: '55%' }}>
            {mode === 'build' && (
              <BuildForm form={buildForm} patch={(p) => setBuildForm({ ...buildForm, ...p })} />
            )}
            {mode === 'sign' && (
              <SignForm form={signForm} patch={(p) => setSignForm({ ...signForm, ...p })} />
            )}
            {mode === 'verify' && (
              <VerifyForm
                form={verifyForm}
                patch={(p) => {
                  // Changing the trust anchor changes the answer.
                  invalidateVerdict()
                  setVerifyForm({ ...verifyForm, ...p })
                }}
              />
            )}
            {mode === 'binding' && (
              <BindingForm
                form={bindingForm}
                patch={(p) => setBindingForm({ ...bindingForm, ...p })}
              />
            )}
          </div>

          <div className="flex-1 min-h-0">
            <MonacoWrapper
              value={xml}
              onChange={(v) => {
                invalidateVerdict()
                setXml(v)
              }}
              language="xml"
            />
          </div>
        </div>
      }
      outputPane={
        error ? (
          <div className="p-3 text-sm" style={{ color: '#cc2200' }}>
            <strong>{t('tools.common.error')}: </strong>
            {error}
          </div>
        ) : verifyResult ? (
          <VerifyReport result={verifyResult} />
        ) : (
          <MonacoWrapper value={output} language="xml" readOnly />
        )
      }
    />
  )
}
