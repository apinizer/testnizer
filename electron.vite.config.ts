import { resolve } from 'path'
import { execSync } from 'node:child_process'
import { defineConfig, type UserConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { PluginOption } from 'vite'

const ANALYZE = process.env.ANALYZE === 'true'

/**
 * Which build this is, stamped in at compile time.
 *
 * Pre-release rounds ship under the SAME `version` as each other and as the
 * final release (1.5.0-rc2, -rc3 and 1.5.0 all report "1.5.0"), so a tester
 * cannot tell from inside the app which one they installed. That is not
 * cosmetic: a fix verified on one round was reported as still broken from
 * another, and the investigation went looking for a platform difference that
 * did not exist. The commit is the one thing that always distinguishes them.
 */
function buildId(): string {
  const fromCi = process.env.GITHUB_SHA
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // A source tarball with no git metadata — the app still runs, it just
    // cannot name its own build.
    return 'unknown'
  }
}

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
        'Run: npm install --save-dev rollup-plugin-visualizer',
    )
    return null
  }
}

export default defineConfig(async (): Promise<UserConfig> => {
  const visualizer = await loadVisualizer()
  const rendererPlugins: PluginOption[] = [react(), tailwindcss()]
  if (visualizer) rendererPlugins.push(visualizer)

  return {
    main: {
      // Dependency externalization (electron-vite 5: `build.externalizeDeps`,
      // which replaced the deprecated `externalizeDepsPlugin` and is ON by
      // default — so the exclusions MUST live here; a leftover plugin call would
      // not stop the default one from externalizing everything).
      //
      // Every dependency stays a runtime `require()` EXCEPT the ESM-only ones
      // listed in `exclude`, which Rollup bundles (ESM→CJS) into out/main:
      //   • `uuid@14` is ESM-ONLY with NO CJS `require` export. Electron 33's
      //     Node 20 could not require() an ES module, so externalizing it
      //     crashed the bundle ON LOAD with ERR_REQUIRE_ESM before
      //     app.whenReady() ran — the v1.4.19 launch-crash regression.
      //   • `jose` (#63/#73) has the same shape: "type":"module", only an ESM
      //     `default` export condition, no `require` condition. Main-side jose
      //     usage goes through TWO documented doors and no others:
      //     src/main/lib/jose-runtime.ts (the jose:* IPC surface) and
      //     src/shared/script/jose.ts (the script sandbox's `require('jose')` /
      //     `pm.jose`, compiled into BOTH bundles so it cannot import a
      //     src/main module). Both are STATIC imports, so this exclusion stays
      //     the single lever that decides how jose enters the bundle.
      //     `tests/main/shared/jose.test.ts` fails if a third door appears or
      //     if 'jose' drops out of this exclude list.
      //   • Electron 44 runs Node 24, where require(ESM) works, so this is no
      //     longer the only thing standing between us and a launch crash. The
      //     bundling stays anyway (issue #291): it is proven, it keeps one module
      //     system in out/main, and a future dependency whose ESM graph uses
      //     top-level await would still fail require(ESM) (ERR_REQUIRE_ASYNC_MODULE).
      //   • Do NOT bundle cheerio / csv-parse: they ship a CJS `require` export,
      //     and bundling cheerio drags in undici and its top-level
      //     `require("node:sqlite")`.
      //   • System Node HIDES this class of bug. Verify launch with the built
      //     app + `npm run test:e2e:smoke`, not bare node.
      define: {
        __BUILD_ID__: JSON.stringify(buildId()),
      },
      build: {
        externalizeDeps: { exclude: ['uuid', 'jose'] },
        // electron-vite derives the syntax target from the Electron major, but
        // its table stops at Electron 39 and silently falls back to that
        // entry. Name the runtime we actually ship: Electron 44 = Node 24.
        target: 'node24',
        rollupOptions: {
          external: [
            'better-sqlite3',
            'soap',
            'ws',
            'eventsource',
            '@grpc/grpc-js',
            '@grpc/proto-loader',
          ],
        },
      },
    },
    preload: {
      build: {
        externalizeDeps: true,
        target: 'node24',
      },
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer'),
        },
      },
      plugins: rendererPlugins,
      build: {
        // Electron 44 = Chromium 152 (see the main `target` note above).
        target: 'chrome152',
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
            },
          },
        },
      },
    },
  }
})
