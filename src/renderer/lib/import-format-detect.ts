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

  // cURL — single-line "curl ..." command (extension rarely meaningful)
  if (/^\s*curl\s+/i.test(trimmed)) return 'curl'

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
        // Postman collection v2.x: info + (postman id OR schema URL)
        const info = obj.info as Record<string, unknown> | undefined
        if (
          info &&
          typeof info === 'object' &&
          (typeof info._postman_id === 'string' ||
            (typeof info.schema === 'string' && info.schema.includes('postman')))
        ) {
          return 'postman'
        }
        // Postman environment export — `_postman_variable_scope: "environment"`
        // plus a `values[]` array. Routed through the Postman import flow; the
        // main handler dispatches collections vs environments internally.
        if (obj._postman_variable_scope === 'environment' && Array.isArray(obj.values)) {
          return 'postman'
        }
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
