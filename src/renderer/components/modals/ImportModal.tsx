import { useState } from 'react'
import { X, Upload, FileText, Globe2, Loader2 } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import { useTranslation } from '../../lib/i18n'

interface ImportFormat {
  id: string
  name: string
  icon: string
  bg: string
  color: string
  mono?: boolean
  serif?: boolean
  badge?: boolean
}

const IMPORT_FORMATS: ImportFormat[] = [
  { id: 'openapi', name: 'OpenAPI/Swagger', icon: '\uD83C\uDF3F', bg: '#e8f9f1', color: '#1a7a4a' },
  { id: 'postman', name: 'Postman', icon: '\uD83D\uDFE0', bg: '#fff0ec', color: '#f25c00' },
  { id: 'insomnia', name: 'Insomnia', icon: '\uD83D\uDFE3', bg: '#faf0ff', color: '#7c4dff' },
  { id: 'curl', name: 'cURL', icon: 'cURL', bg: '#e8f4ff', color: '#1565c0', mono: true },
  { id: 'apidog', name: 'Apidog', icon: '\u25C8', bg: '#f0f0ff', color: '#7c73e6' },
  { id: 'har', name: '.har File', icon: 'har', bg: '#fff3e0', color: '#e65100', mono: true, badge: true },
  { id: 'jmeter', name: 'JMeter', icon: '\uD83D\uDCC4', bg: '#fce4ec', color: '#c62828' },
  { id: 'apidoc', name: 'apiDoc', icon: 'A', bg: '#e8f5e9', color: '#2e7d32', serif: true },
  { id: 'raml', name: 'RAML', icon: 'RAML', bg: '#e3f2fd', color: '#1976d2', mono: true },
  { id: 'iodoc', name: 'I/O Doc', icon: '\u26A1', bg: '#fce4ec', color: '#e91e63' },
  { id: 'wsdl', name: 'WSDL', icon: 'WSDL', bg: '#e3f2fd', color: '#1565c0', mono: true },
  { id: 'wadl', name: 'WADL', icon: 'WADL', bg: '#e8f5e9', color: '#388e3c', mono: true },
  { id: 'google', name: 'Google Discovery', icon: '\u2726', bg: '#fafafa', color: '#4285f4' },
  { id: 'proto', name: '.proto file', icon: '\u2B21', bg: '#e8f5e9', color: '#00897b' },
  { id: 'soapui', name: 'SoapUI', icon: '\u2600', bg: '#fff8e1', color: '#f9a825' },
  { id: 'hoppscotch', name: 'Hoppscotch', icon: '\uD83E\uDD97', bg: '#e8f5e9', color: '#00b96b' },
]

const URL_IMPORTABLE = ['openapi', 'wsdl', 'wadl', 'raml', 'google']
const FILE_IMPORTABLE = ['openapi', 'postman', 'insomnia', 'curl', 'har', 'jmeter', 'apidoc', 'raml', 'iodoc', 'wsdl', 'wadl', 'proto', 'soapui', 'hoppscotch', 'apidog']

function FormatIcon({ fmt }: { fmt: ImportFormat }) {
  if (fmt.mono) {
    return (
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: fmt.bg }}
      >
        <span
          className="font-mono font-extrabold"
          style={{
            fontSize: fmt.badge ? 12 : 14,
            color: fmt.badge ? 'white' : fmt.color,
            background: fmt.badge ? fmt.color : 'transparent',
            padding: fmt.badge ? '2px 4px' : 0,
            borderRadius: fmt.badge ? 3 : 0,
          }}
        >
          {fmt.icon}
        </span>
      </div>
    )
  }
  if (fmt.serif) {
    return (
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: fmt.bg }}
      >
        <span
          className="text-[1.857rem] font-black"
          style={{ color: fmt.color, fontFamily: 'Georgia, serif' }}
        >
          {fmt.icon}
        </span>
      </div>
    )
  }
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl"
      style={{ background: fmt.bg }}
    >
      {fmt.icon}
    </div>
  )
}

export default function ImportModal() {
  const showImportModal = useUIStore((s) => s.showImportModal)
  const setShowImportModal = useUIStore((s) => s.setShowImportModal)
  const openTab = useTabsStore((s) => s.openTab)
  const setSoapWsdlUrl = useSoapStore((s) => s.setWsdlUrl)
  const parseSoapWsdl = useSoapStore((s) => s.parseWsdl)
  const { t } = useTranslation()

  const [selectedIdx, setSelectedIdx] = useState(0)
  const [step, setStep] = useState<1 | 2>(1)
  const [importUrl, setImportUrl] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')

  if (!showImportModal) return null

  const selectedFormat = IMPORT_FORMATS[selectedIdx]
  const canUrlImport = URL_IMPORTABLE.includes(selectedFormat.id)
  const canFileImport = FILE_IMPORTABLE.includes(selectedFormat.id)

  function handleClose() {
    setShowImportModal(false)
    setStep(1)
    setImportUrl('')
    setImportError('')
    setImportLoading(false)
  }

  function handleNext() {
    if (step === 1) {
      setStep(2)
      setImportUrl('')
      setImportError('')
    }
  }

  function handleBack() {
    setStep(1)
    setImportError('')
  }

  async function handleImportUrl() {
    if (!importUrl.trim()) return
    setImportLoading(true)
    setImportError('')

    try {
      if (selectedFormat.id === 'wsdl') {
        const tabId = 'tab-' + Math.random().toString(36).substring(2, 10)
        setSoapWsdlUrl(importUrl.trim())
        openTab({
          id: tabId,
          name: 'SOAP \u2014 ' + new URL(importUrl.trim()).hostname,
          protocol: 'soap',
          method: 'POST',
          url: importUrl.trim(),
        })
        await parseSoapWsdl()
        handleClose()
      } else if (selectedFormat.id === 'openapi') {
        const result = await window.api?.importExport?.importOpenApi({ url: importUrl.trim() })
        if (result?.success) {
          handleClose()
        } else {
          setImportError(result?.error || 'Failed to import OpenAPI spec')
        }
      } else {
        setImportError('URL import is not yet supported for this format')
      }
    } catch (err) {
      setImportError((err as Error).message || 'Import failed')
    } finally {
      setImportLoading(false)
    }
  }

  async function handleImportFile() {
    setImportLoading(true)
    setImportError('')

    try {
      const result = await window.api?.importExport?.openFile()
      if (!result?.success || !result.data) {
        setImportLoading(false)
        return
      }

      const fileData = result.data as { content: string; filePath: string }

      if (selectedFormat.id === 'wsdl') {
        const tabId = 'tab-' + Math.random().toString(36).substring(2, 10)
        openTab({
          id: tabId,
          name: 'SOAP \u2014 ' + (fileData.filePath.split('/').pop() || 'WSDL'),
          protocol: 'soap',
          method: 'POST',
          url: '',
        })
        const parseResult = await window.api?.soap?.parseWsdlFile(fileData.content)
        if (parseResult?.success) {
          handleClose()
        } else {
          setImportError(parseResult?.error || 'Failed to parse WSDL file')
        }
      } else if (selectedFormat.id === 'openapi') {
        const importResult = await window.api?.importExport?.importOpenApi({ content: fileData.content })
        if (importResult?.success) handleClose()
        else setImportError(importResult?.error || 'Failed to import OpenAPI spec')
      } else if (selectedFormat.id === 'postman') {
        const importResult = await window.api?.importExport?.importPostman({ content: fileData.content })
        if (importResult?.success) handleClose()
        else setImportError(importResult?.error || 'Failed to import Postman collection')
      } else if (selectedFormat.id === 'curl') {
        const importResult = await window.api?.importExport?.importCurl({ content: fileData.content })
        if (importResult?.success) handleClose()
        else setImportError(importResult?.error || 'Failed to import cURL')
      } else if (selectedFormat.id === 'har') {
        const importResult = await window.api?.importExport?.importHar({ content: fileData.content })
        if (importResult?.success) handleClose()
        else setImportError(importResult?.error || 'Failed to import HAR file')
      } else if (selectedFormat.id === 'insomnia') {
        const importResult = await window.api?.importExport?.importInsomnia({ content: fileData.content })
        if (importResult?.success) handleClose()
        else setImportError(importResult?.error || 'Failed to import Insomnia collection')
      } else {
        setImportError('File import is not yet implemented for this format')
      }
    } catch (err) {
      setImportError((err as Error).message || 'Import failed')
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.28)' }}
      onClick={handleClose}
    >
      <div
        className="w-[860px] max-w-[95%] rounded-[14px] bg-[var(--white)] p-7 px-8"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="mb-1 text-[1.57rem] font-bold text-[var(--text)]">
              {step === 1 ? t('import.title') : `Import ${selectedFormat.name}`}
            </div>
            <div className="text-[0.875rem] text-[var(--muted)]">
              {step === 1
                ? t('import.subtitle')
                : `Enter a URL or upload a ${selectedFormat.name} file to import`}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="cursor-pointer p-1 text-[1.57rem] leading-none text-[var(--hint)] hover:text-[var(--text)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <X size={18} />
          </button>
        </div>

        {step === 1 && (
          <>
            {/* Grid */}
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {IMPORT_FORMATS.map((fmt, i) => (
                <button
                  key={fmt.name}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className="flex cursor-pointer flex-col items-center gap-[7px] rounded-[10px] px-2 pb-3 pt-3.5 text-center text-[0.875rem] transition-all"
                  style={{
                    border: `1.5px solid ${selectedIdx === i ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectedIdx === i ? 'var(--accent-light)' : 'var(--white)',
                    color: selectedIdx === i ? 'var(--accent-text)' : '#444',
                  }}
                >
                  <FormatIcon fmt={fmt} />
                  <span>{fmt.name}</span>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="mt-6 flex justify-end gap-2.5 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[0.875rem] text-[#555] transition-colors hover:bg-[var(--bg)]"
              >
                {t('import.cancel')}
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] text-[0.875rem] font-semibold text-white transition-colors hover:opacity-90"
              >
                {t('import.next')} {'\u2192'}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="space-y-4">
              {/* URL input */}
              {canUrlImport && (
                <div>
                  <label className="mb-2 flex items-center gap-1.5 text-[0.875rem] font-medium text-[var(--text)]">
                    <Globe2 size={15} />
                    Import from URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleImportUrl()
                      }}
                      placeholder={
                        selectedFormat.id === 'wsdl'
                          ? 'https://example.com/service?wsdl'
                          : 'https://example.com/api/openapi.json'
                      }
                      className="flex-1 rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 font-mono text-[0.875rem] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={handleImportUrl}
                      disabled={importLoading || !importUrl.trim()}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-[var(--accent)] px-4 py-2 text-[0.875rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {importLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Upload size={14} />
                      )}
                      Import
                    </button>
                  </div>
                </div>
              )}

              {canUrlImport && canFileImport && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-[0.875rem] text-[var(--hint)]">or</span>
                  <div className="h-px flex-1 bg-[var(--border)]" />
                </div>
              )}

              {/* File upload */}
              {canFileImport && (
                <div>
                  <label className="mb-2 flex items-center gap-1.5 text-[0.875rem] font-medium text-[var(--text)]">
                    <FileText size={15} />
                    Import from file
                  </label>
                  <button
                    type="button"
                    onClick={handleImportFile}
                    disabled={importLoading}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border2)] py-6 text-[0.875rem] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: 'transparent' }}
                  >
                    {importLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Upload size={16} />
                    )}
                    Click to select a {selectedFormat.name} file
                  </button>
                </div>
              )}

              {importError && (
                <div
                  className="rounded-lg px-3 py-2 text-[0.875rem]"
                  style={{ background: '#fff0f0', color: '#cc2200', border: '1px solid #f5b3b3' }}
                >
                  {importError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-6 flex justify-between border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={handleBack}
                className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[0.875rem] text-[#555] transition-colors hover:bg-[var(--bg)]"
              >
                {'\u2190'} Back
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[0.875rem] text-[#555] transition-colors hover:bg-[var(--bg)]"
              >
                {t('import.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
