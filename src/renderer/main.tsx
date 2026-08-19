import './polyfills' // MUST be first: installs Buffer/global for the shared script runtime deps
import './styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import './monaco-workers'
import { installNativeContextMenu } from './lib/native-context-menu'

// Right-click Cut/Copy/Paste for every field in the app (issue #113). Installed
// once here rather than per-component: the listener is window-level and steps
// aside for the app's own context menus.
installNativeContextMenu()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
