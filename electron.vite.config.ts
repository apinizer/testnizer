import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { PluginOption } from 'vite'

const ANALYZE = process.env.ANALYZE === 'true'

// Visualizer is a dev-only optional dep; loaded lazily so production builds
// don't require it to be installed when ANALYZE isn't set.
async function loadVisualizer(): Promise<PluginOption | null> {
  if (!ANALYZE) return null
  try {
    const mod = await import('rollup-plugin-visualizer')
    return mod.visualizer({
      filename: resolve('out/renderer/bundle-stats.html'),
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }) as PluginOption
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      '[electron.vite.config] ANALYZE=true but rollup-plugin-visualizer is not installed. ' +
        'Run: npm install --save-dev rollup-plugin-visualizer'
    )
    return null
  }
}

export default defineConfig(async () => {
  const visualizer = await loadVisualizer()
  const rendererPlugins: PluginOption[] = [react(), tailwindcss()]
  if (visualizer) rendererPlugins.push(visualizer)

  return {
    main: {
      // The shared script runtime (src/shared/script) pulls script deps into
      // the MAIN process graph (via runner.handler.ts). `uuid@14` is ESM-ONLY
      // with NO CJS `require` export (its package.json `exports` map has only
      // `node`/`default`, both ESM) — so externalizeDepsPlugin leaving it as a
      // runtime `require("uuid")` crashes the bundle ON LOAD under Electron's
      // Node 20 (no require(ESM) support) with ERR_REQUIRE_ESM, before
      // app.whenReady() ever runs — the v1.4.19 launch-crash regression.
      // Excluding uuid from externalization makes Rollup bundle it (ESM→CJS)
      // into out/main, so there is no runtime require() of an ES module.
      //   • Only uuid needs this: cheerio + csv-parse are also ESM packages but
      //     ship a CJS `require` export, so Node 20 resolves them fine when
      //     externalized — do NOT bundle them (bundling cheerio drags in undici
      //     and its top-level `require("node:sqlite")`, a Node-22-only builtin
      //     absent in Electron's Node 20, re-crashing the bundle).
      //   • System Node ≥22 HIDES this class of bug: it supports require(ESM),
      //     so a plain `node -e "require('uuid')"` test passes while Electron
      //     (Node 20) crashes. Verify launch with the built app, not bare node.
      plugins: [externalizeDepsPlugin({ exclude: ['uuid'] })],
      build: {
        rollupOptions: {
          external: [
            'better-sqlite3',
            'soap',
            'ws',
            'eventsource',
            '@grpc/grpc-js',
            '@grpc/proto-loader'
          ]
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer')
        }
      },
      plugins: rendererPlugins,
      build: {
        rollupOptions: {
          output: {
            // Split monaco-editor (and its @monaco-editor/react adapter) into
            // its own chunk so it doesn't bloat the initial renderer bundle.
            // Combined with React.lazy in MonacoWrapper, this makes the
            // editor truly load on demand.
            manualChunks(id: string) {
              if (id.includes('node_modules/monaco-editor/')) return 'monaco-editor'
              if (id.includes('node_modules/@monaco-editor/')) return 'monaco-editor'
              return undefined
            }
          }
        }
      }
    }
  }
})
