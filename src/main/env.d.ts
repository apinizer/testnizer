/**
 * Compile-time constants injected into the main bundle by electron-vite.
 *
 * `__BUILD_ID__` is the short git commit the bundle was built from. It exists
 * because pre-release rounds ship under the same `version` string as one
 * another and as the final release, so the version cannot identify a build —
 * see the `buildId()` helper in electron.vite.config.ts.
 *
 * It is replaced at build time, so it is a plain string literal at runtime, not
 * a variable that could be undefined. Under vitest, where no `define` runs, the
 * reference is guarded with a `typeof` check at its one call site.
 */
declare const __BUILD_ID__: string
