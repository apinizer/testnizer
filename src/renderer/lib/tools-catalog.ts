import {
  Wrench,
  KeyRound,
  Braces,
  Code2,
  Binary,
  GitCompare,
  Search,
  FileSearch,
  FileCode,
  Shuffle,
  Shield,
  Hash,
  Fingerprint,
  FileJson,
  Repeat,
  Clock,
  ListChecks,
  Calculator,
  Tag,
  Regex,
  ArrowLeftRight,
} from 'lucide-react'
import type { ToolProtocol } from '../types'

export interface ToolCatalogItem {
  protocol: ToolProtocol
  Icon: typeof Wrench
  labelKey: string
  bg: string
  color: string
}

/**
 * Tools menu order — content/format tools first, utilities at the bottom.
 *
 *   1. JWT Debugger          most common — almost every API session uses tokens
 *   2. JSON Formatter        constant — pretty-print / minify response bodies
 *   3. XML Formatter         counterpart of JSON formatter for XML / SOAP
 *   4. Encode / Decode       Base64 / URL encoding everywhere
 *   5. Text Diff             compare two response bodies / contracts
 *   6. JSON Schema Generator infer schemas from samples
 *   7. JSONPath Evaluator    extract from JSON responses
 *   8. XPath Evaluator       extract from XML / SOAP responses
 *   9. JSON ↔ XML            interop bridge for SOAP ↔ REST teams
 *  10. XSLT Evaluator        transformation
 *  11. Jolt Evaluator        spec-driven JSON shaping
 *  12. WS-Security           SOAP-only, niche
 *  ── utility calculators ──
 *  13. Hash Calculator       checksums, signature debugging
 *  14. HMAC Generator        request signing (AWS, webhooks, etc.)
 *  15. Epoch Converter       JWT iat/exp, log timestamps
 *  16. HTTP Status Codes     daily reference
 *  17. Base Converter        bin / dec / hex / ASCII for byte-level debugging
 */
export const TOOL_CATALOG: ToolCatalogItem[] = [
  {
    protocol: 'tools.jwt',
    Icon: KeyRound,
    labelKey: 'tools.jwt.title',
    bg: '#eeecfe',
    color: '#5b52d4',
  },
  {
    protocol: 'tools.jsonFormat',
    Icon: Braces,
    labelKey: 'tools.json.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  {
    protocol: 'tools.xmlFormat',
    Icon: Code2,
    labelKey: 'tools.xml.title',
    bg: '#fff4e0',
    color: '#b35a00',
  },
  {
    protocol: 'tools.encode',
    Icon: Binary,
    labelKey: 'tools.encode.title',
    bg: '#e8f9f1',
    color: '#1a7a4a',
  },
  {
    protocol: 'tools.diff',
    Icon: GitCompare,
    labelKey: 'tools.diff.title',
    bg: '#fff0f0',
    color: '#cc2200',
  },
  {
    protocol: 'tools.jsonSchema',
    Icon: FileJson,
    labelKey: 'tools.jsonSchema.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  {
    protocol: 'tools.jsonpath',
    Icon: Search,
    labelKey: 'tools.jsonpath.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  {
    protocol: 'tools.xpath',
    Icon: FileSearch,
    labelKey: 'tools.xpath.title',
    bg: '#fff4e0',
    color: '#b35a00',
  },
  {
    protocol: 'tools.jsonXml',
    Icon: Repeat,
    labelKey: 'tools.jsonXml.title',
    bg: '#eeecfe',
    color: '#5b52d4',
  },
  {
    protocol: 'tools.xslt',
    Icon: FileCode,
    labelKey: 'tools.xslt.title',
    bg: '#f0faf5',
    color: '#0a7a5a',
  },
  {
    protocol: 'tools.jolt',
    Icon: Shuffle,
    labelKey: 'tools.jolt.title',
    bg: '#eeecfe',
    color: '#5b52d4',
  },
  {
    protocol: 'tools.wsSecurity',
    Icon: Shield,
    labelKey: 'tools.wsse.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  // ── utility calculators ──
  {
    protocol: 'tools.hash',
    Icon: Hash,
    labelKey: 'tools.hash.title',
    bg: '#f0faf5',
    color: '#0a7a5a',
  },
  {
    protocol: 'tools.hmac',
    Icon: Fingerprint,
    labelKey: 'tools.hmac.title',
    bg: '#fff4e0',
    color: '#b35a00',
  },
  {
    protocol: 'tools.epoch',
    Icon: Clock,
    labelKey: 'tools.epoch.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  {
    protocol: 'tools.httpStatus',
    Icon: ListChecks,
    labelKey: 'tools.httpStatus.title',
    bg: '#fff0f0',
    color: '#cc2200',
  },
  {
    protocol: 'tools.base',
    Icon: Calculator,
    labelKey: 'tools.base.title',
    bg: '#f0faf5',
    color: '#0a7a5a',
  },
  {
    protocol: 'tools.uuid',
    Icon: Tag,
    labelKey: 'tools.uuid.title',
    bg: '#eeecfe',
    color: '#5b52d4',
  },
  {
    protocol: 'tools.regex',
    Icon: Regex,
    labelKey: 'tools.regex.title',
    bg: '#fff0f0',
    color: '#cc2200',
  },
  {
    protocol: 'tools.yamlJson',
    Icon: ArrowLeftRight,
    labelKey: 'tools.yamlJson.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
]
