# /bootstrap

Projeyi sıfırdan kurar.

## Adım 1 — electron-vite ile başlat

```bash
npm create electron-vite@latest . -- --template react-ts
npm install
```

## Adım 2 — Tüm bağımlılıkları kur

```bash
# UI bileşenleri
npm install tailwindcss @tailwindcss/vite postcss autoprefixer
npm install class-variance-authority clsx tailwind-merge lucide-react
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu
npm install @radix-ui/react-tabs @radix-ui/react-tooltip
npm install @radix-ui/react-separator @radix-ui/react-scroll-area
npm install @radix-ui/react-context-menu @radix-ui/react-select
npm install @radix-ui/react-popover @radix-ui/react-checkbox
npm install @radix-ui/react-switch @radix-ui/react-accordion

# shadcn/ui
npx shadcn@latest init
npx shadcn@latest add button input select tabs dialog tooltip badge
npx shadcn@latest add dropdown-menu context-menu scroll-area separator

# Monaco Editor
npm install @monaco-editor/react

# State
npm install zustand

# Layout
npm install react-resizable-panels
npm install @tanstack/react-virtual

# Main process
npm install axios ws eventsource
npm install node-soap wsse fast-xml-parser
npm install graphql graphql-ws
npm install @grpc/grpc-js @grpc/proto-loader
npm install tough-cookie axios-cookiejar-support

# Import/Export parsing
npm install @readme/openapi-parser js-yaml

# Database + config
npm install better-sqlite3 electron-store
npm install electron-updater electron-window-state

# Dev dependencies
npm install --save-dev @types/better-sqlite3 @types/ws
npm install --save-dev electron-builder @types/js-yaml @types/node-soap
```

## Adım 3 — Tailwind kur

```bash
npx tailwindcss init -p
```

`tailwind.config.js`:
```js
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/renderer/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

## Adım 4 — CSS değişkenleri

`src/renderer/styles/globals.css` içine `docs/UI-SPEC.md §1` renk değişkenlerini ekle.

## Adım 5 — Monaco tema

`src/renderer/lib/monaco-theme.ts`:
```typescript
import * as monaco from 'monaco-editor'

export function registerMonacoThemes() {
  // Açık tema: varsayılan 'vs' yeterli
  // Koyu tema
  monaco.editor.defineTheme('apinizer-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#1e1e2e',
      'editor.foreground': '#e2e2f0',
      'editor.lineHighlightBackground': '#252540',
      'editorLineNumber.foreground': '#666688',
    }
  })
}
```

## Adım 6 — electron.vite.config.ts

Main process external packages (bundle edilmemeli):
```typescript
main: {
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'node-soap', 'ws', 'eventsource', '@grpc/grpc-js', '@grpc/proto-loader']
    }
  }
}
```

## Adım 7 — Verify

```bash
npm run dev
```

Uygulama açılmalı, title bar görünmeli.

## Sonraki adım

```
/implement-phase 1
```
