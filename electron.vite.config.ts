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
      plugins: [externalizeDepsPlugin()],
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
