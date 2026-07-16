// Dedicated Import dropdown that sits next to the "+" New button on the
// APIs / Tests sidebars. Clicking it shows a categorised vertical list of
// formats; a click opens the Import wizard already on step 2 with that
// format selected.
//
// The earlier version used coloured logo tiles — but half the formats
// (cURL / RAML / WSDL) didn't have a real logo, so we were rendering a
// monospace text badge that just repeated the label. Apidog handles this
// by dropping the logo wall entirely and listing the formats by category
// (specs / collections / quick). Mirroring that here cleans up the menu
// and keeps it scannable.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'

interface ImportFormatOption {
  id: string
  name: string
  // Single-word qualifier shown muted on the right of each row, when
  // helpful ("openapi → spec", "postman → collection"). Empty string
  // suppresses the qualifier on rows where the label is self-explanatory.
  qualifier?: string
}

interface ImportFormatCategory {
  titleKey: string
  options: ImportFormatOption[]
}

// IDs match IMPORT_FORMATS in ImportModal.tsx so the modal's step-2
// short-circuit (importModalInitialFormatId) can find the format.
const CATEGORIES: ImportFormatCategory[] = [
  {
    titleKey: 'importDropdown.section.specs',
    options: [
      { id: 'openapi', name: 'OpenAPI / Swagger' },
      { id: 'raml', name: 'RAML' },
      { id: 'wsdl', name: 'WSDL' },
      { id: 'proto', name: '.proto file' },
    ],
  },
  {
    titleKey: 'importDropdown.section.collections',
    options: [
      { id: 'apinizer', name: 'Apinizer' },
      { id: 'postman', name: 'Postman' },
      { id: 'insomnia', name: 'Insomnia' },
      { id: 'har', name: 'HAR' },
      { id: 'soapui', name: 'SoapUI' },
      { id: 'native', name: 'Testnizer Native' },
    ],
  },
  {
    titleKey: 'importDropdown.section.quick',
    options: [{ id: 'curl', name: 'cURL' }],
  },
]

export default function ImportDropdown() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const setShowImportModal = useUIStore((s) => s.setShowImportModal)

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, left: rect.left })
    }
  }, [])

  useEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  const handlePick = (formatId: string) => {
    setOpen(false)
    setShowImportModal(true, formatId)
  }

  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] rounded-xl border border-[var(--border)] bg-[var(--white)] py-2"
          style={{
            top: pos.top,
            left: pos.left,
            width: 240,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            animation: 'slideDown 0.15s ease',
          }}
        >
          <div
            className="mb-1 px-3 pt-1 font-medium uppercase tracking-widest"
            style={{ color: 'var(--hint)', fontSize: 11 }}
          >
            {t('importDropdown.title')}
          </div>
          {CATEGORIES.map((cat, ci) => (
            <div key={cat.titleKey}>
              {ci > 0 && (
                <div
                  style={{
                    height: 1,
                    background: 'var(--border)',
                    margin: '4px 8px',
                  }}
                />
              )}
              <div
                className="px-3 pt-1.5 pb-0.5 font-medium"
                style={{
                  color: 'var(--muted)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {t(cat.titleKey)}
              </div>
              {cat.options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handlePick(opt.id)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1.5 hover:bg-[var(--bg)]"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    textAlign: 'left',
                    fontSize: 13,
                  }}
                >
                  <span>{opt.name}</span>
                  {opt.qualifier && (
                    <span style={{ color: 'var(--hint)', fontSize: 11 }}>{opt.qualifier}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('importDropdown.title')}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('importDropdown.tooltip')}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        // Inline 28×28 + rounded-[7px] keep the button identical in size
        // to the "+" New button next to it, so the two icons land on the
        // same baseline regardless of sidebar (APIs / Tests).
        className="flex cursor-pointer items-center justify-center rounded-[7px] border text-[var(--muted)] hover:bg-[var(--bg)]"
        style={{
          width: 28,
          height: 28,
          borderColor: 'var(--border2)',
          background: 'var(--white)',
        }}
      >
        <Download size={15} strokeWidth={2.5} />
      </button>
      {dropdown}
    </>
  )
}
