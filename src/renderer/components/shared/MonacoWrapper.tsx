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
          folding: true,
          wordWrap: 'on',
          fontSize: fontSize - 2,
          fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
          fontLigatures: true,
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderLineHighlight: 'line',
          smoothScrolling: true,
          readOnly,
          domReadOnly: readOnly,
        }}
      />
    </div>
  )
}
