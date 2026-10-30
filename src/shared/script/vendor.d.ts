/**
 * Ambient module declarations for sandbox libraries that ship without bundled
 * TypeScript types. They're re-exported through the script `require()` registry
 * as opaque modules, so untyped is acceptable here (kept out of app code).
 */
declare module 'lodash'
declare module 'tv4'
declare module 'xml2js'
declare module 'postman-collection'

/**
 * Postman's own dynamic-variable table (`{{$guid}}`, `{{$randomFirstName}}`, …),
 * CommonJS `module.exports = { $name: { description, generator } }`. Typed
 * here (not left `any`) because src/shared/dynamic-variables.ts reads it.
 */
declare module 'postman-collection/lib/superstring/dynamic-variables' {
  interface PostmanDynamicGenerator {
    description: string
    generator: () => unknown
  }
  const generators: Record<string, PostmanDynamicGenerator>
  export = generators
}
