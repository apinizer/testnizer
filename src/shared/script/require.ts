/**
 * Sandbox `require(...)` — the built-in library set Postman/Insomnia scripts
 * expect. Shared by Send and Run so both resolve the SAME modules. Everything
 * is statically imported (sync, like Postman's require) and therefore bundled
 * into both the renderer and main bundles (the "Tam set" scope decision).
 */
import _ from 'lodash'
import moment from 'moment'
import * as uuid from 'uuid'
import CryptoJS from 'crypto-js'
import * as cheerio from 'cheerio'
import Ajv from 'ajv'
import tv4 from 'tv4'
import * as xml2js from 'xml2js'
import { parse as csvParseSync } from 'csv-parse/sync'
import * as postmanCollection from 'postman-collection'
import * as chai from 'chai'
// jose (#73) enters through ./jose — the shared runtime's SINGLE jose door.
// It must be a static import there (and only there) so Rollup/Vite bundle it;
// see the header of ./jose.ts for the ERR_REQUIRE_ESM containment story.
import { joseModule } from './jose'
import { base64Encode, base64Decode } from './base64'

/** Exact `require('...')` strings Postman supports → the resolved module. */
const LIBS: Record<string, unknown> = {
  lodash: _,
  moment,
  uuid,
  'crypto-js': CryptoJS,
  cheerio,
  ajv: Ajv,
  tv4,
  xml2js,
  // csv-parse: Postman uses the v4 path; v5 uses '/sync'. Support both.
  'csv-parse/lib/sync': csvParseSync,
  'csv-parse/sync': { parse: csvParseSync },
  'postman-collection': postmanCollection,
  chai,
  // JWS/JWT signing inside scripts (#73). The namespace object is resolved at
  // module-eval time, so `require('jose')` is a map lookup — no dynamic module
  // resolution a bundler could miss. Sub-path specifiers ('jose/jwt/sign', …)
  // are intentionally NOT registered: the namespace carries every export.
  jose: joseModule,
}

/** The synchronous require() exposed inside scripts. */
export function sandboxRequire(name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(LIBS, name)) return LIBS[name]
  throw new Error(
    `Cannot find module '${name}' in the Testnizer script sandbox. ` +
      `Supported: ${Object.keys(LIBS).join(', ')}.`,
  )
}

/** Globals every script gets bound (mirrors Postman's sandbox globals). */
export const scriptGlobals = {
  CryptoJS,
  _,
  atob: base64Decode,
  btoa: base64Encode,
} as const
