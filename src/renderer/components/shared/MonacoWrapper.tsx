import Editor from '@monaco-editor/react'
import { useUIStore } from '../../stores/ui.store'

interface MonacoWrapperProps {
  value: string
  onChange?: (value: string) => void
  language?: string
  readOnly?: boolean
  lineNumbers?: 'on' | 'off'
  height?: string | number
  className?: string
}

export default function MonacoWrapper({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  lineNumbers = 'on',
  height = '100%',
  className,
}: MonacoWrapperProps) {
  const theme = useUIStore((s) => s.theme)
  const fontSize = useUIStore((s) => s.fontSize)
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme

  return (
    <div className={className} style={{ height }}>
      <Editor
        height="100%"
        language={language}
        value={value}
        onChange={(val) => onChange?.(val ?? '')}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
        options={{
          minimap: { enabled: false },
          lineNumbers,
          lineNumbersMinChars: 3,
          folding: true,
          wordWrap: 'on',
          fontSize: fontSize - 2,
          fontWeight: '400',
          fontFamily: "Menlo, Monaco, Consolas, 'SF Mono', 'Cascadia Code', monospace",
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
        }}
      />
    </div>
  )
}
