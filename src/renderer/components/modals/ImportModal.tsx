import { useEffect, useState } from 'react'
import {
  X,
  Upload,
  FileText,
  Globe2,
  Loader2,
  FolderPlus,
  FolderOpen,
  ChevronRight,
  Check,
} from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { detectImportFormat, checkTypeMismatch } from '../../lib/import-format-detect'
import Modal from '../shared/Modal'
import type { WsdlParseResult, TreeNode } from '../../types'

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
  {
    id: 'native',
    name: 'Testnizer Native',
    icon: 'TZ',
    bg: '#eeecfe',
    color: '#5b52d4',
    mono: true,
  },
  { id: 'openapi', name: 'OpenAPI/Swagger', icon: '\uD83C\uDF3F', bg: '#e8f9f1', color: '#1a7a4a' },
  { id: 'postman', name: 'Postman', icon: '\uD83D\uDFE0', bg: '#fff0ec', color: '#f25c00' },
  { id: 'insomnia', name: 'Insomnia', icon: '\uD83D\uDFE3', bg: '#faf0ff', color: '#7c4dff' },
  { id: 'har', name: 'HAR', icon: 'HAR', bg: '#e8f4ff', color: '#1565c0', mono: true },
  { id: 'curl', name: 'cURL', icon: 'cURL', bg: '#e8f4ff', color: '#1565c0', mono: true },
  { id: 'raml', name: 'RAML', icon: 'RAML', bg: '#e3f2fd', color: '#1976d2', mono: true },
  { id: 'wsdl', name: 'WSDL', icon: 'WSDL', bg: '#e3f2fd', color: '#1565c0', mono: true },
  { id: 'proto', name: '.proto file', icon: '\u2B21', bg: '#e8f5e9', color: '#00897b' },
  { id: 'soapui', name: 'SoapUI', icon: '\u2600', bg: '#fff8e1', color: '#f9a825' },
]

const URL_IMPORTABLE = ['openapi', 'wsdl', 'raml']
const FILE_IMPORTABLE = [
  'native',
  'openapi',
  'postman',
  'insomnia',
  'har',
  'curl',
  'raml',
  'wsdl',
  'proto',
  'soapui',
]

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

/** Recursively collect all folders from tree for the folder picker.
 *  Recurses into module/folder nodes to find nested folders. */
function collectFolders(
  nodes: TreeNode[],
  depth: number = 0,
): Array<{ node: TreeNode; depth: number }> {
  const result: Array<{ node: TreeNode; depth: number }> = []
  for (const n of nodes) {
    if (n.type === 'folder') {
      result.push({ node: n, depth })
      if (n.children) {
        result.push(...collectFolders(n.children, depth + 1))
      }
    } else if (n.children) {
      // Recurse into module/root nodes to find folders inside them
      result.push(...collectFolders(n.children, depth))
    }
  }
  return result
}

export default function ImportModal() {
  const showImportModal = useUIStore((s) => s.showImportModal)
  const setShowImportModal = useUIStore((s) => s.setShowImportModal)
  const importModalInitialFormatId = useUIStore((s) => s.importModalInitialFormatId)
  const { t } = useTranslation()

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const treeData = useWorkspaceStore((s) => s.treeData)
  const refreshTree = useWorkspaceStore((s) => s.refreshTree)

  const [selectedIdx, setSelectedIdx] = useState(0)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // When the modal is opened with a pre-selected format (e.g. via the
  // Import dropdown next to "+" on the APIs sidebar), seed both the format
  // index and the step so the user lands on the Source step right away.
  // The effect only fires on transitions of (modal-open, format-id), so
  // user navigation back to step 1 inside the modal still works.
  useEffect(() => {
    if (!showImportModal) return
    if (!importModalInitialFormatId) return
    const idx = IMPORT_FORMATS.findIndex((f) => f.id === importModalInitialFormatId)
    if (idx >= 0) {
      setSelectedIdx(idx)
      setStep(2)
    }
  }, [showImportModal, importModalInitialFormatId])
  const [importUrl, setImportUrl] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState('')

  // File content stored after selecting file in step 2 — used for import in step 3
  const [pendingFileContent, setPendingFileContent] = useState<string | null>(null)
  const [pendingFileName, setPendingFileName] = useState('')
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null)
  const [pendingSourceUrl, setPendingSourceUrl] = useState('')

  // cURL paste buffer — separate from pendingFileContent so the textarea
  // remains controlled while the user edits it. Committed into
  // pendingFileContent only when "Continue" is pressed (v1.3.1 B19).
  const [curlPasteText, setCurlPasteText] = useState('')

  // Proto-specific (gRPC) — optional server address override
  const [protoServerAddress, setProtoServerAddress] = useState('')

  // Folder selection (step 3) — unified for ALL formats
  const [folderMode, setFolderMode] = useState<'new' | 'existing' | 'root'>('new')
  const [newFolderName, setNewFolderName] = useState('')
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  // WSDL-specific
  const [wsdlParsed, setWsdlParsed] = useState<WsdlParseResult | null>(null)

  if (!showImportModal) return null

  const selectedFormat = IMPORT_FORMATS[selectedIdx]
  const canUrlImport = URL_IMPORTABLE.includes(selectedFormat.id)
  const canFileImport = FILE_IMPORTABLE.includes(selectedFormat.id)
  const allFolders = collectFolders(treeData)

  function handleClose() {
    setShowImportModal(false)
    setStep(1)
    setImportUrl('')
    setImportError('')
    setImportLoading(false)
    setPendingFileContent(null)
    setPendingFileName('')
    setPendingFilePath(null)
    setProtoServerAddress('')
    setFolderMode('new')
    setNewFolderName('')
    setTargetFolderId(null)
    setImporting(false)
    setWsdlParsed(null)
    setCurlPasteText('')
  }

  /** Commit a pasted cURL string and advance to the folder step. */
  function handleCurlPasteContinue() {
    const text = curlPasteText.trim()
    if (!text) {
      setImportError('Paste a cURL command first.')
      return
    }
    if (!/^\s*curl\b/i.test(text)) {
      setImportError('That does not look like a cURL command (must start with "curl").')
      return
    }
    setImportError('')
    setPendingFileContent(text)
    setPendingFileName('cURL')
    goToFolderStep('cURL Import')
  }

  function handleNext() {
    if (step === 1) {
      setStep(2)
      setImportUrl('')
      setImportError('')
      setPendingFileContent(null)
      setPendingFileName('')
    }
  }

  function handleBack() {
    if (step === 3) {
      setStep(2)
      setImportError('')
    } else if (step === 2) {
      setStep(1)
      setImportError('')
    }
  }

  /** Transition to step 3 (folder selection) */
  function goToFolderStep(suggestedName?: string) {
    setFolderMode('new')
    setNewFolderName(suggestedName || selectedFormat.name)
    setTargetFolderId(null)
    setStep(3)
  }

  /** Handle URL input — either parse (WSDL) or store for step 3 */
  async function handleImportUrl() {
    if (!importUrl.trim()) return
    setImportLoading(true)
    setImportError('')

    try {
      if (selectedFormat.id === 'wsdl') {
        const parseResult = await window.api?.importExport?.parseWsdlForImport(importUrl.trim())
        if (parseResult?.success && parseResult.data) {
          const parsed = parseResult.data as WsdlParseResult
          setWsdlParsed(parsed)
          const suggestName = parsed.services.length > 0 ? parsed.services[0].name : 'WSDL Import'
          goToFolderStep(suggestName)
        } else {
          setImportError(parseResult?.error || 'Failed to parse WSDL')
        }
      } else {
        // For URL-importable formats, fetch content from URL
        const url = importUrl.trim()
        try {
          const fetchResult = (await window.api?.importExport?.fetchUrl?.(url)) as
            | { success: boolean; data?: unknown; error?: string }
            | undefined
          if (fetchResult?.success && fetchResult.data) {
            const content =
              typeof fetchResult.data === 'string'
                ? fetchResult.data
                : JSON.stringify(fetchResult.data, null, 2)
            // Same mismatch guard as file uploads — catches the case
            // where a `?wsdl` URL is pasted under the OpenAPI option.
            const detected = detectImportFormat(content, url)
            const mismatch = checkTypeMismatch(selectedFormat.id, detected)
            if (mismatch) {
              setImportError(
                t('import.typeMismatch')
                  .replace('{expected}', mismatch.expected)
                  .replace('{detected}', mismatch.detected),
              )
              setImportLoading(false)
              return
            }
            setPendingFileContent(content)
            setPendingSourceUrl(url)
          } else {
            setImportError(fetchResult?.error || 'Failed to fetch URL')
            setImportLoading(false)
            return
          }
        } catch (fetchErr) {
          setImportError((fetchErr as Error).message || 'Failed to fetch URL')
          setImportLoading(false)
          return
        }
        setPendingFileName('')
        goToFolderStep()
      }
    } catch (err) {
      setImportError((err as Error).message || 'Import failed')
    } finally {
      setImportLoading(false)
    }
  }

  /** Handle file selection — store content and go to step 3 */
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

      // Detect the file's actual format and surface obvious mismatches
      // BEFORE the user spends time picking a destination folder.
      const detected = detectImportFormat(fileData.content, fileData.filePath)
      const mismatch = checkTypeMismatch(selectedFormat.id, detected)
      if (mismatch) {
        setImportError(
          t('import.typeMismatch')
            .replace('{expected}', mismatch.expected)
            .replace('{detected}', mismatch.detected),
        )
        setImportLoading(false)
        return
      }

      if (selectedFormat.id === 'wsdl') {
        const parseResult = await window.api?.importExport?.parseWsdlFileForImport(fileData.content)
        if (parseResult?.success && parseResult.data) {
          const parsed = parseResult.data as WsdlParseResult
          setWsdlParsed(parsed)
          const suggestName = parsed.services.length > 0 ? parsed.services[0].name : 'WSDL Import'
          setPendingFileContent(fileData.content)
          goToFolderStep(suggestName)
        } else {
          setImportError(parseResult?.error || 'Failed to parse WSDL file')
        }
      } else {
        // Store file content + path and proceed to folder selection
        setPendingFileContent(fileData.content)
        setPendingFilePath(fileData.filePath)
        const fname = fileData.filePath.split('/').pop()?.split('\\').pop() || selectedFormat.name
        setPendingFileName(fname.replace(/\.[^.]+$/, ''))
        goToFolderStep(fname.replace(/\.[^.]+$/, ''))
      }
    } catch (err) {
      setImportError((err as Error).message || 'Import failed')
    } finally {
      setImportLoading(false)
    }
  }

  /** Final import with folder selection (step 3) */
  async function handleFinalImport() {
    if (!activeProjectId) return
    // For WSDL we use wsdlParsed, for others we use pendingFileContent
    if (!wsdlParsed && !pendingFileContent) return
    setImporting(true)
    setImportError('')

    const pid = activeProjectId

    // Create folder if needed. Native imports are skipped here: a native
    // *project* export becomes a brand-new project (no folder), and a native
    // *folder* export carries its own folder structure that importFolder
    // remaps under the chosen destination — so an extra placeholder folder
    // would just sit empty (issues #11, #32).
    let folderId: string | null = null
    if (selectedFormat.id !== 'native' && folderMode === 'new' && newFolderName.trim()) {
      try {
        const folderResult = await window.api?.folder?.create({
          project_id: pid,
          parent_id: null,
          name: newFolderName.trim(),
        })
        if (folderResult?.success && folderResult.data) {
          folderId = (folderResult.data as { id: string }).id
        }
      } catch {
        /* continue without folder */
      }
    } else if (folderMode === 'existing' && targetFolderId) {
      folderId = targetFolderId
    }

    try {
      const fmtId = selectedFormat.id
      // The IPC wrapper returns `{ success: true, data: importerResult }` on
      // success; internal importer failures arrive as
      // `{ success: true, data: { success: false, error } }`. We must inspect
      // both layers so users don't see "Imported" for an empty result.
      let importResult:
        | {
            success: boolean
            data?: { success?: boolean; error?: string }
            error?: string
          }
        | undefined

      if (fmtId === 'wsdl') {
        importResult = (await window.api?.importExport?.importWsdl({
          projectId: pid,
          targetFolderId: folderId,
          createNewFolder: false, // folder already created above if needed
          wsdlUrl: importUrl.trim() || undefined,
          parsedWsdl: wsdlParsed!,
        })) as typeof importResult
      } else if (fmtId === 'openapi') {
        importResult = (await window.api?.importExport?.importOpenApi({
          projectId: pid,
          content: pendingFileContent || '',
          format: 'openapi',
          folderId,
          sourceUrl: pendingSourceUrl || undefined,
        })) as typeof importResult
      } else if (fmtId === 'postman') {
        importResult = (await window.api?.importExport?.importPostman({
          projectId: pid,
          content: pendingFileContent || '',
          folderId,
        })) as typeof importResult
      } else if (fmtId === 'insomnia') {
        importResult = (await window.api?.importExport?.importInsomnia({
          projectId: pid,
          content: pendingFileContent || '',
          folderId,
        })) as typeof importResult
      } else if (fmtId === 'har') {
        importResult = (await window.api?.importExport?.importHar({
          projectId: pid,
          content: pendingFileContent || '',
          folderId,
        })) as typeof importResult
      } else if (fmtId === 'curl') {
        importResult = (await window.api?.importExport?.importCurl({
          projectId: pid,
          curlCommand: pendingFileContent || '',
          folderId,
        })) as typeof importResult
      } else if (fmtId === 'proto') {
        if (!pendingFilePath) {
          setImportError('Proto file path missing — please re-select the file')
          setImporting(false)
          return
        }
        importResult = (await window.api?.importExport?.importProto({
          projectId: pid,
          protoPath: pendingFilePath,
          folderId,
          serverAddress: protoServerAddress.trim() || undefined,
        })) as typeof importResult
      } else if (fmtId === 'raml') {
        importResult = (await window.api?.importExport?.importRaml({
          projectId: pid,
          content: pendingFileContent || '',
          folderId,
        })) as typeof importResult
      } else if (fmtId === 'soapui') {
        importResult = (await window.api?.importExport?.importSoapUi({
          projectId: pid,
          content: pendingFileContent || '',
          folderId,
        })) as typeof importResult
      } else if (fmtId === 'native') {
        // Testnizer native JSON comes in two shapes:
        //   kind: 'folder'  → a collection export; import its endpoints INTO
        //                      the current project (honors the destination
        //                      folder) so a folder export/import round-trips
        //                      losslessly (#32).
        //   kind: 'project' → a full project export; import as a NEW project
        //                      in the workspace and switch to it (#11).
        // Before, both went through importProjectFromContent + a placeholder
        // folder.create, so the current project showed an empty folder while
        // the real data either errored (folder export failed project
        // validation) or landed in an unnoticed new project.
        let parsed: { kind?: string }
        try {
          parsed = JSON.parse(pendingFileContent || '{}')
        } catch (e) {
          importResult = { success: false, error: 'Invalid JSON: ' + (e as Error).message }
          parsed = {}
        }
        if (parsed.kind === 'folder') {
          importResult = (await window.api?.save?.importFolder?.({
            projectId: pid,
            parentFolderId: folderMode === 'existing' ? targetFolderId : null,
            content: pendingFileContent || '',
          })) as typeof importResult
        } else if (parsed.kind === 'project' || parsed.kind === undefined) {
          const wsId = useWorkspaceStore.getState().activeWorkspaceId
          if (!wsId) {
            setImportError('No active workspace')
            setImporting(false)
            return
          }
          importResult = (await window.api?.save?.importProjectFromContent?.({
            workspaceId: wsId,
            content: pendingFileContent || '',
          })) as typeof importResult
          // Surface the imported project: refresh the workspace project list so
          // it shows on the Home grid without an app restart (#32 follow-up —
          // setActiveProject alone left `projects` stale, so the new project
          // only appeared after a reload), then switch to it.
          const newPid = (importResult?.data as { projectId?: string } | undefined)?.projectId
          if (importResult?.success && newPid) {
            await useWorkspaceStore.getState().fetchProjects(wsId)
            useWorkspaceStore.getState().setActiveProject(newPid)
          }
        } else {
          importResult = {
            success: false,
            error: `Unsupported native export kind: ${parsed.kind}`,
          }
        }
      } else {
        setImportError('Import not yet implemented for this format')
        setImporting(false)
        return
      }

      const ipcOk = importResult?.success === true
      const importerOk = importResult?.data?.success !== false
      if (ipcOk && importerOk) {
        await refreshTree()
        // Postman/Insomnia imports may create a project-scoped environment for
        // collection variables. Refresh the env store so the new env shows up
        // in the selector without requiring an app reload.
        if (fmtId === 'postman' || fmtId === 'insomnia') {
          await useEnvironmentStore.getState().fetchEnvironments()
        }
        toast.success(t('toast.imported'))
        handleClose()
      } else {
        // Final-step import failure: surface globally so it's visible even
        // after the modal closes on a successful retry. The parse-step
        // errors above stay in the modal because they relate to the
        // current input field.
        const errMsg = importResult?.data?.error || importResult?.error || t('toast.importFailed')
        toast.error(errMsg)
        setImportError(errMsg)
      }
    } catch (err) {
      toast.error((err as Error).message || t('toast.importFailed'))
      setImportError((err as Error).message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      open={showImportModal}
      onOpenChange={(o) => !o && handleClose()}
      title={t('import.title')}
      testId="import-modal"
    >
      <div
        className="w-[720px] max-w-[95%] rounded-[14px] bg-[var(--white)] p-7 px-8"
        style={{ boxShadow: 'var(--shadow-modal)' }}
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="mb-1 text-[1.57rem] font-bold text-[var(--text)]">
              {step === 1
                ? t('import.title')
                : step === 2
                  ? `Import ${selectedFormat.name}`
                  : 'Import Destination'}
            </div>
            <div className="text-[var(--muted)]">
              {step === 1
                ? t('import.subtitle')
                : step === 2
                  ? selectedFormat.id === 'curl'
                    ? 'Paste a cURL command or load it from a file'
                    : canUrlImport
                      ? `Enter a URL or upload a ${selectedFormat.name} file to import`
                      : `Upload a ${selectedFormat.name} file to import`
                  : 'Choose where to import the data'}
            </div>
          </div>
          <button
            type="button"
            aria-label={t('a11y.closeDialog')}
            onClick={handleClose}
            className="cursor-pointer p-1 text-[1.57rem] leading-none text-[var(--hint)] hover:text-[var(--text)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="mb-5 flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full font-bold"
                style={{
                  background: step >= s ? 'var(--accent)' : 'var(--surface)',
                  color: step >= s ? 'white' : 'var(--hint)',
                  border: step >= s ? 'none' : '1px solid var(--border2)',
                }}
              >
                {step > s ? <Check size={12} /> : s}
              </div>
              <span
                style={{
                  color: step >= s ? 'var(--text)' : 'var(--hint)',
                  fontWeight: step === s ? 600 : 400,
                }}
              >
                {s === 1 ? 'Format' : s === 2 ? 'Source' : 'Destination'}
              </span>
              {s < 3 && (
                <div
                  className="mx-1 h-px w-8"
                  style={{ background: step > s ? 'var(--accent)' : 'var(--border)' }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Format selection */}
        {step === 1 && (
          <>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {IMPORT_FORMATS.map((fmt, i) => (
                <button
                  key={fmt.name}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className="flex cursor-pointer flex-col items-center gap-[7px] rounded-[10px] px-2 pb-3 pt-3.5 text-center transition-all"
                  style={{
                    border: `1.5px solid ${selectedIdx === i ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectedIdx === i ? 'var(--accent-light)' : 'var(--white)',
                    color: selectedIdx === i ? 'var(--accent-text)' : 'var(--text)',
                  }}
                >
                  <FormatIcon fmt={fmt} />
                  <span>{fmt.name}</span>
                </button>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-2.5 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[var(--sub)] transition-colors hover:bg-[var(--bg)]"
              >
                {t('import.cancel')}
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="cursor-pointer rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] font-semibold text-white transition-colors hover:opacity-90"
              >
                {t('import.next')} {'\u2192'}
              </button>
            </div>
          </>
        )}

        {/* Step 2: URL / File input */}
        {step === 2 && (
          <>
            <div className="space-y-4">
              {selectedFormat.id === 'curl' && (
                <div>
                  <label className="mb-2 flex items-center gap-1.5 font-medium text-[var(--text)]">
                    <FileText size={15} aria-hidden="true" />
                    Paste a cURL command
                  </label>
                  <textarea
                    value={curlPasteText}
                    onChange={(e) => setCurlPasteText(e.target.value)}
                    placeholder={`curl -X POST 'https://api.example.com/v1/users' \\\n  -H 'Authorization: Bearer ...' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"Alice"}'`}
                    rows={8}
                    spellCheck={false}
                    className="w-full resize-y rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 font-mono text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[var(--hint)]" style={{ fontSize: 12 }}>
                      Or load from a file using the picker below.
                    </span>
                    <button
                      type="button"
                      onClick={handleCurlPasteContinue}
                      disabled={!curlPasteText.trim() || importLoading}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-[var(--accent)] px-3 py-1.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Upload size={14} aria-hidden="true" />
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {selectedFormat.id === 'curl' && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-[var(--hint)]">or</span>
                  <div className="h-px flex-1 bg-[var(--border)]" />
                </div>
              )}

              {canUrlImport && (
                <div>
                  <label className="mb-2 flex items-center gap-1.5 font-medium text-[var(--text)]">
                    <Globe2 size={15} aria-hidden="true" />
                    Import from URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      aria-label="Import URL"
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
                      className="flex-1 rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-1.5 font-mono text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={handleImportUrl}
                      disabled={importLoading || !importUrl.trim()}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-[var(--accent)] px-3 py-1.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {importLoading ? (
                        <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Upload size={14} aria-hidden="true" />
                      )}
                      Next
                    </button>
                  </div>
                </div>
              )}

              {canUrlImport && canFileImport && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-[var(--hint)]">or</span>
                  <div className="h-px flex-1 bg-[var(--border)]" />
                </div>
              )}

              {canFileImport && (
                <div>
                  <label className="mb-2 flex items-center gap-1.5 font-medium text-[var(--text)]">
                    <FileText size={15} aria-hidden="true" />
                    Import from file
                  </label>
                  <button
                    type="button"
                    onClick={handleImportFile}
                    disabled={importLoading}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border2)] py-4 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="rounded-lg px-3 py-2"
                  style={{ background: '#fff0f0', color: '#cc2200', border: '1px solid #f5b3b3' }}
                >
                  {importError}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-between border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={handleBack}
                className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[var(--sub)] transition-colors hover:bg-[var(--bg)]"
              >
                {'\u2190'} Back
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[var(--sub)] transition-colors hover:bg-[var(--bg)]"
              >
                {t('import.cancel')}
              </button>
            </div>
          </>
        )}

        {/* Step 3: Folder / Destination selection */}
        {step === 3 && (
          <>
            <div className="space-y-4">
              {/* WSDL summary (if applicable) */}
              {wsdlParsed && (
                <div
                  className="rounded-lg p-4"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="mb-2 font-semibold text-[var(--text)]">
                    WSDL Parsed Successfully
                  </div>
                  <div className="space-y-1 text-[var(--muted)]">
                    {wsdlParsed.services.map((svc) => (
                      <div key={svc.name}>
                        <span className="font-medium text-[var(--text)]">{svc.name}</span>
                        {svc.ports.map((port) => (
                          <div key={port.name} className="ml-4">
                            {port.name} — {port.operations.length} operation
                            {port.operations.length !== 1 ? 's' : ''}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File info (non-WSDL) */}
              {!wsdlParsed && pendingFileName && (
                <div
                  className="flex items-center gap-2 rounded-lg p-3"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <FileText size={16} className="text-[var(--accent)]" />
                  <span className="text-[var(--text)]">
                    Ready to import: <span className="font-semibold">{pendingFileName}</span>
                  </span>
                </div>
              )}

              {/* Folder Selection */}
              <div>
                <div className="mb-3 font-semibold text-[var(--text)]">Import Destination</div>

                {/* New folder */}
                <label
                  className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg p-3 transition-colors"
                  style={{
                    border: `1.5px solid ${folderMode === 'new' ? 'var(--accent)' : 'var(--border)'}`,
                    background: folderMode === 'new' ? 'var(--accent-light)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="importFolder"
                    checked={folderMode === 'new'}
                    onChange={() => setFolderMode('new')}
                    className="accent-[var(--accent)]"
                  />
                  <FolderPlus size={16} className="text-[var(--accent)]" />
                  <span className="text-[var(--text)]">Create new folder</span>
                </label>
                {folderMode === 'new' && (
                  <div className="mb-2 ml-8">
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Folder name"
                      className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                )}

                {/* Existing folder */}
                <label
                  className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg p-3 transition-colors"
                  style={{
                    border: `1.5px solid ${folderMode === 'existing' ? 'var(--accent)' : 'var(--border)'}`,
                    background: folderMode === 'existing' ? 'var(--accent-light)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="importFolder"
                    checked={folderMode === 'existing'}
                    onChange={() => setFolderMode('existing')}
                    className="accent-[var(--accent)]"
                  />
                  <FolderOpen size={16} className="text-[var(--accent)]" />
                  <span className="text-[var(--text)]">Add to existing folder</span>
                </label>
                {folderMode === 'existing' && (
                  <div className="mb-2 ml-8 max-h-[160px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
                    {allFolders.map(({ node: folder, depth }) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setTargetFolderId(folder.id)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent-light)]"
                        style={{
                          paddingLeft: 8 + depth * 16,
                          background:
                            targetFolderId === folder.id ? 'var(--accent-light)' : 'transparent',
                          color:
                            targetFolderId === folder.id ? 'var(--accent-text)' : 'var(--text)',
                          border: 'none',
                        }}
                      >
                        <ChevronRight size={12} />
                        {folder.label}
                      </button>
                    ))}
                    {allFolders.length === 0 && (
                      <div className="py-2 text-center text-[var(--hint)]">No folders found</div>
                    )}
                  </div>
                )}

                {/* Root level */}
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-lg p-3 transition-colors"
                  style={{
                    border: `1.5px solid ${folderMode === 'root' ? 'var(--accent)' : 'var(--border)'}`,
                    background: folderMode === 'root' ? 'var(--accent-light)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="importFolder"
                    checked={folderMode === 'root'}
                    onChange={() => setFolderMode('root')}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-[var(--text)]">Project root (no folder)</span>
                </label>
              </div>

              {selectedFormat.id === 'proto' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium text-[var(--sub)]">
                    gRPC server address (optional)
                  </label>
                  <input
                    type="text"
                    value={protoServerAddress}
                    onChange={(e) => setProtoServerAddress(e.target.value)}
                    placeholder="localhost:50051"
                    className="w-full rounded-lg border border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <span className="text-[11px] text-[var(--hint)]">
                    Used as the default server for every imported method. Leave empty to use
                    localhost:50051.
                  </span>
                </div>
              )}

              {importError && (
                <div
                  className="rounded-lg px-3 py-2"
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
                className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[var(--sub)] transition-colors hover:bg-[var(--bg)]"
              >
                {'\u2190'} Back
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[var(--sub)] transition-colors hover:bg-[var(--bg)]"
                >
                  {t('import.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleFinalImport}
                  disabled={importing || (folderMode === 'existing' && !targetFolderId)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-[7px] border-none bg-[var(--accent)] px-[18px] py-[7px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  Import
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
