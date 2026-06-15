/**
 * Ambient module declarations for sandbox libraries that ship without bundled
 * TypeScript types. They're re-exported through the script `require()` registry
 * as opaque modules, so untyped is acceptable here (kept out of app code).
 */
declare module 'lodash'
declare module 'tv4'
declare module 'xml2js'
declare module 'postman-collection'
