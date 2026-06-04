import type { editor } from 'monaco-editor'

export const testnizerDarkTheme: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1e2e',
    'editor.foreground': '#e2e2f0',
    'editor.lineHighlightBackground': '#252540',
    'editorLineNumber.foreground': '#666688',
  },
}
