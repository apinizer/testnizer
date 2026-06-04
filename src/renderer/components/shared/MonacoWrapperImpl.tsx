import { useRef, useEffect } from 'react'
import Editor, { loader, type Monaco } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { useUIStore } from '../../stores/ui.store'
import { useEnvironmentStore } from '../../stores/environment.store'

/** CSS class name used by Monaco decorations to colorize {{variables}} */
const VARIABLE_DECO_CLASS = 'monaco-variable-highlight'

/** Make sure the CSS rule is injected exactly once */
let variableStyleInjected = false
function ensureVariableStyle(): void {
  if (variableStyleInjected) return
  variableStyleInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .${VARIABLE_DECO_CLASS} {
      color: var(--variable-color, #0066cc) !important;
      font-weight: 500;
    }
  `
  document.head.appendChild(style)
}

/** Scan the model and apply variable highlight decorations. */
function applyVariableHighlights(ed: editor.IStandaloneCodeEditor, prev: string[]): string[] {
  const model = ed.getModel()
  if (!model) return prev
  const text = model.getValue()
  const re = /\{\{[^}]*?\}\}/g
  const decos: editor.IModelDeltaDecoration[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = model.getPositionAt(m.index)
    const end = model.getPositionAt(m.index + m[0].length)
    decos.push({
      range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
      options: { inlineClassName: VARIABLE_DECO_CLASS },
    })
  }
  return ed.deltaDecorations(prev, decos)
}

// Bundle Monaco locally — @monaco-editor/react defaults to loading from a
// jsdelivr CDN which is blocked by our strict Content-Security-Policy
// (connect-src 'self'). Passing the local module makes the editor load
// entirely from the app bundle.
loader.config({ monaco })

/** Built-in dynamic variables for Monaco autocomplete */
const BUILTIN_DYNAMIC_VARS: { name: string; description: string }[] = [
  { name: '$randomInt', description: 'Random integer 0-1000' },
  { name: '$randomInt(min,max)', description: 'Random integer in range' },
  { name: '$timestamp', description: 'Unix timestamp (seconds)' },
  { name: '$isoTimestamp', description: 'ISO 8601 date string' },
  { name: '$randomUUID', description: 'Random UUID v4' },
  { name: '$randomEmail', description: 'Random email address' },
  { name: '$randomName', description: 'Random full name' },
  { name: '$randomString', description: 'Random 8-char string' },
  { name: '$randomString(n)', description: 'Random n-char string' },
  { name: '$datetime(format)', description: 'Formatted date (YYYY-MM-DD etc.)' },
]

interface MonacoWrapperProps {
  value: string
  onChange?: (value: string) => void
  language?: string
  readOnly?: boolean
  lineNumbers?: 'on' | 'off'
  height?: string | number
  className?: string
  wordWrap?: boolean
}

/** Track registered disposables so we don't register multiple providers */
let completionDisposable: { dispose: () => void } | null = null

function registerVariableCompletionProvider(monaco: Monaco) {
  // Only register once globally
  if (completionDisposable) return
  completionDisposable = monaco.languages.registerCompletionItemProvider('*', {
    triggerCharacters: ['{'],
    provideCompletionItems: (
      model: editor.ITextModel,
      position: { lineNumber: number; column: number },
    ) => {
      const textUntilPos = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      // Check if we're inside {{ context
      const lastOpen = textUntilPos.lastIndexOf('{{')
      const lastClose = textUntilPos.lastIndexOf('}}')
      if (lastOpen === -1 || lastOpen < lastClose) {
        return { suggestions: [] }
      }

      const query = textUntilPos.slice(lastOpen + 2).toLowerCase()

      // Range to replace: from after {{ to current cursor position
      const replaceRange = {
        startLineNumber: position.lineNumber,
        startColumn: lastOpen + 3, // after {{
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }

      const envStore = useEnvironmentStore.getState()
      const suggestions: Array<{
        label: string
        kind: number
        detail: string
        insertText: string
        range: typeof replaceRange
        sortText: string
      }> = []

      // Environment variables
      const activeEnv = envStore.environments.find((e) => e.id === envStore.activeEnvironmentId)
      if (activeEnv) {
        activeEnv.variables
          .filter((v) => v.enabled && v.key.toLowerCase().includes(query))
          .forEach((v) => {
            suggestions.push({
              label: v.key,
              kind: monaco.languages.CompletionItemKind.Variable,
              detail: `[ENV] ${v.value || v.initialValue || ''}`,
              insertText: `${v.key}}}`,
              range: replaceRange,
              sortText: `0_${v.key}`,
            })
          })
      }

      // Global variables
      envStore.globalVariables
        .filter((v) => v.enabled && v.key.toLowerCase().includes(query))
        .forEach((v) => {
          suggestions.push({
            label: v.key,
            kind: monaco.languages.CompletionItemKind.Constant,
            detail: `[GLOBAL] ${v.value || v.initialValue || ''}`,
            insertText: `${v.key}}}`,
            range: replaceRange,
            sortText: `1_${v.key}`,
          })
        })

      // Built-in dynamic variables
      BUILTIN_DYNAMIC_VARS.filter((v) => v.name.toLowerCase().includes(query)).forEach((v) => {
        suggestions.push({
          label: v.name,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: `[DYNAMIC] ${v.description}`,
          insertText: `${v.name}}}`,
          range: replaceRange,
          sortText: `2_${v.name}`,
        })
      })

      return { suggestions }
    },
  })
}

export default function MonacoWrapperImpl({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  lineNumbers = 'on',
  height = '100%',
  className,
  wordWrap = true,
}: MonacoWrapperProps) {
  const theme = useUIStore((s) => s.theme)
  const fontSize = useUIStore((s) => s.fontSize)
  const resolvedTheme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const decoIdsRef = useRef<string[]>([])

  const handleEditorMount = (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    monacoRef.current = monaco
    editorRef.current = ed
    ensureVariableStyle()
    if (!readOnly) {
      registerVariableCompletionProvider(monaco)
    }
    // Initial highlight + refresh on content change
    decoIdsRef.current = applyVariableHighlights(ed, decoIdsRef.current)
    ed.onDidChangeModelContent(() => {
      decoIdsRef.current = applyVariableHighlights(ed, decoIdsRef.current)
    })
  }

  // Cleanup on unmount is not needed since we register globally once

  useEffect(() => {
    // If `value` prop changes from outside, refresh decorations too
    const ed = editorRef.current
    if (ed) {
      decoIdsRef.current = applyVariableHighlights(ed, decoIdsRef.current)
    }
  }, [value])

  useEffect(() => {
    return () => {
      editorRef.current = null
    }
  }, [])

  return (
    <div className={className} style={{ height }}>
      <Editor
        height="100%"
        language={language}
        value={value}
        onChange={(val) => onChange?.(val ?? '')}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
        onMount={handleEditorMount}
        options={{
          minimap: { enabled: false },
          lineNumbers,
          lineNumbersMinChars: 3,
          folding: true,
          wordWrap: wordWrap ? 'on' : 'off',
          fontSize: fontSize - 2,
          fontWeight: '400',
          fontFamily: 'var(--font-mono)',
          fontLigatures: false,
          padding: { top: 6, bottom: 6 },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderLineHighlight: readOnly ? 'none' : 'line',
          smoothScrolling: true,
          readOnly,
          domReadOnly: readOnly,
          glyphMargin: false,
          lineDecorationsWidth: 4,
          overviewRulerBorder: false,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: true,
          },
        }}
      />
    </div>
  )
}

export type { MonacoWrapperProps }
