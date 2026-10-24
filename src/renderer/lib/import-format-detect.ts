// src/renderer/lib/import-format-detect.ts
//
// Heuristic format detection for the Import modal. The goal is to catch
// obvious mismatches between the user-selected import type (REST API /
// Postman / WSDL / ...) and the actual content of the file or URL they
// supplied — without falsely blocking valid-but-unusual inputs.
//
// Detection is intentionally conservative: when we can't be sure, we
// return `null` and let the import proceed (the protocol-specific parser
// will report a more accurate error if the content is truly bad).

import { startsWithCurl } from '../../shared/curl'
import { classifyPostmanDocument, classifyPostmanText } from '../../shared/postman-detect'

/**
 * Inspect a content snippet (and optional file path) and return a
 * coarse format bucket: `wsdl` | `soapui` | `proto` | `raml` | `openapi`
 * | `postman` | `insomnia` | `curl` | `har` | generic `json` | `xml` —
 * or `null` if nothing matches.
 *
 * Pure / browser-safe. No DOM, no network.
 */
export function detectImportFormat(content: string, filePath?: string | null): string | null {
  const ext = (filePath?.split('.').pop() || '').toLowerCase()
  // Strip UTF-8 BOM (U+FEFF) if present, then drop leading whitespace.
  const trimmed = content.replace(/^\uFEFF/, '').trimStart()
  const head = trimmed.slice(0, 4096)

  // cURL — `curl …` / `curl.exe …` in any of the three shells, optionally
  // after a `$ ` / `PS> ` prompt or PowerShell's `&` (issue #279).
  if (startsWithCurl(trimmed) && /\S\s+\S/.test(trimmed)) return 'curl'

  // XML-family: WSDL, SoapUI. RAML uses YAML so it's handled below.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    // WSDL: <definitions> root or wsdl: namespace prefix
    if (
      /<(\w+:)?definitions[\s>]/i.test(head) ||
      /xmlns(:\w+)?\s*=\s*["']http:\/\/schemas\.xmlsoap\.org\/wsdl/i.test(head) ||
      /<wsdl:/i.test(head)
    ) {
      return 'wsdl'
    }
    // SoapUI / ReadyAPI projects
    if (
      /<con:soapui-project/i.test(head) ||
      /xmlns(:\w+)?\s*=\s*["']http:\/\/eviware\.com\/soapui\/config/i.test(head)
    ) {
      return 'soapui'
    }
    // Generic XML — caller decides whether that's compatible
    return 'xml'
  }

  // proto IDL — `syntax = "proto3";` or `.proto` extension
  if (ext === 'proto' || /^\s*syntax\s*=\s*['"]proto[23]['"]/m.test(head)) {
    return 'proto'
  }

  // RAML — first non-empty line is "#%RAML 1.0"
  if (/^#%RAML\b/m.test(head)) return 'raml'

  // YAML-style OpenAPI/Swagger (no JSON braces)
  if (/^(openapi|swagger)\s*:/m.test(head)) return 'openapi'

  // Postman v3 YAML (`$kind: collection` / `$kind: http-request` …) — routed
  // to the Postman importer: a single file of a v3 folder is answered with a
  // pointer to "Import folder…" (issue #276 part 2).
  if (!head.startsWith('{') && !head.startsWith('[') && classifyPostmanText(trimmed)) {
    return 'postman'
  }

  // JSON-family detection — try to parse
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>
        // Testnizer Native — project / folder / testSuite exports all carry
        // a string `kind` field and a `testnizer-*` version. Without this
        // branch a v1.4.4-exported project flagged as generic JSON and the
        // mismatch guard rejected it with "Selected type is native but file
        // appears to be JSON" (v1.4.4 §6.2).
        if (
          (obj.kind === 'project' || obj.kind === 'folder' || obj.kind === 'testSuite') &&
          typeof obj.version === 'string'
        ) {
          return 'native'
        }
        if (typeof obj.version === 'string' && obj.version.startsWith('testnizer-')) {
          return 'native'
        }
        // OpenAPI / Swagger
        if (typeof obj.openapi === 'string' || typeof obj.swagger === 'string') {
          return 'openapi'
        }
        // Every Postman artifact — collection v1 / v2.0 / v2.1 (no
        // `_postman_id` needed), environment, globals, legacy data dump, v3 —
        // through the ONE shared classifier the main importer uses (#276).
        // The Postman importer routes each kind itself.
        if (classifyPostmanDocument(obj)) return 'postman'
        // Insomnia v4 export
        if (obj._type === 'export' && Array.isArray(obj.resources)) {
          return 'insomnia'
        }
        // Insomnia v5 — type === "collection.insomnia.rest/5.0"
        if (typeof obj.type === 'string' && obj.type.startsWith('collection.insomnia')) {
          return 'insomnia'
        }
        // HAR — log.entries
        const log = obj.log as Record<string, unknown> | undefined
        if (log && Array.isArray(log.entries)) return 'har'
        return 'json'
      }
      if (Array.isArray(parsed)) return 'json'
    } catch {
      return null
    }
  }

  return null
}

/**
 * Returns `{detected, expected}` (with human-readable labels) when the
 * detected format is incompatible with the user-selected import type,
 * or `null` when the two are compatible (or detection was inconclusive).
 */
export function checkTypeMismatch(
  selectedFormatId: string,
  detected: string | null,
): { detected: string; expected: string } | null {
  if (!detected) return null

  // Detected bucket → list of selected-format IDs that accept it.
  const accepted: Record<string, string[]> = {
    wsdl: ['wsdl'],
    soapui: ['soapui'],
    proto: ['proto'],
    raml: ['raml'],
    openapi: ['openapi'],
    // Apinizer test collections ARE Postman v2.1 (+ x-apinizer), so they
    // detect as `postman`; accept them under either the Postman or the
    // Apinizer import card (both route to importPostman).
    postman: ['postman', 'apinizer'],
    insomnia: ['insomnia'],
    curl: ['curl'],
    native: ['native'],
    har: ['har'], // HAR now has its own import card
    // generic buckets — many formats are JSON or XML, so don't flag a
    // mismatch when detection isn't more specific than that. `native` is
    // also added here so a Testnizer export that misses the strict tagged
    // detection still routes through the native importer (which carries
    // its own structural validator).
    json: ['openapi', 'postman', 'apinizer', 'insomnia', 'raml', 'native'],
    xml: ['wsdl', 'soapui'],
  }

  const allowed = accepted[detected]
  if (!allowed) return null
  if (allowed.includes(selectedFormatId)) return null

  const human: Record<string, string> = {
    openapi: 'OpenAPI/Swagger',
    postman: 'Postman',
    apinizer: 'Apinizer',
    insomnia: 'Insomnia',
    curl: 'cURL',
    raml: 'RAML',
    wsdl: 'WSDL',
    proto: '.proto',
    soapui: 'SoapUI',
    native: 'Testnizer Native',
    har: 'HAR',
    json: 'JSON',
    xml: 'XML',
  }
  return {
    detected: human[detected] || detected,
    expected: human[selectedFormatId] || selectedFormatId,
  }
}
