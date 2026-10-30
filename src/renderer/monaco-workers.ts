// Monaco worker registration — Vite's `?worker` suffix creates real Web
// Workers bundled from the local monaco-editor package, satisfying our
// strict CSP (`worker-src 'self' blob:`) without any CDN fetch.
//
// Without this, Monaco falls back to an inline worker proxy that attempts
// to load monaco's JS from a CDN and stalls on "Loading..." in production.
//
// Since monaco-editor 0.56 the package has an `exports` map (`"./*.js"` →
// `./esm/vs/*.js`), so the worker subpaths drop the old `esm/vs/` prefix;
// `monaco-editor/esm/vs/…` no longer resolves and the build fails. Keep the
// explicit `.js`: Vite 5 did not resolve the extensionless `language/…`
// paths through the `"./*"` fallback.

import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  },
}
