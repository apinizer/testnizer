import { DOMParser } from '@xmldom/xmldom'
import * as xpath from 'xpath'

export type XPathNamespaceBindings = Record<string, string>

export type XPathResult =
  | {
      ok: true
      kind: 'nodes'
      values: string[]
      count: number
    }
  | { ok: true; kind: 'string'; value: string }
  | { ok: true; kind: 'number'; value: number }
  | { ok: true; kind: 'boolean'; value: boolean }
  | { ok: false; error: string }

/**
 * Evaluate an XPath 1.0 expression against an XML document.
 * `namespaces` is an optional prefix→URI map used by `useNamespaces` so
 * expressions like `//soap:Body/foo:Bar` resolve correctly.
 */
export function evaluateXPath(
  xml: string,
  expression: string,
  namespaces: XPathNamespaceBindings = {},
): XPathResult {
  if (!expression?.trim()) return { ok: false, error: 'Expression is empty' }

  let doc: Document
  try {
    const parser = new DOMParser({
      onError: (level, msg) => {
        if (level === 'error' || level === 'fatalError') {
          throw new Error(msg)
        }
      },
    })
    doc = parser.parseFromString(xml, 'text/xml') as unknown as Document
  } catch (e) {
    return { ok: false, error: 'Invalid XML: ' + (e instanceof Error ? e.message : String(e)) }
  }

  let select: ReturnType<typeof xpath.useNamespaces>
  try {
    select = xpath.useNamespaces(namespaces)
  } catch (e) {
    return {
      ok: false,
      error: 'Namespace binding error: ' + (e instanceof Error ? e.message : String(e)),
    }
  }

  let raw: unknown
  try {
    raw = select(expression, doc as unknown as Node)
  } catch (e) {
    return { ok: false, error: 'XPath error: ' + (e instanceof Error ? e.message : String(e)) }
  }

  if (typeof raw === 'string') return { ok: true, kind: 'string', value: raw }
  if (typeof raw === 'number') return { ok: true, kind: 'number', value: raw }
  if (typeof raw === 'boolean') return { ok: true, kind: 'boolean', value: raw }
  if (Array.isArray(raw)) {
    const values = (raw as Node[]).map((n) => serializeNode(n))
    return { ok: true, kind: 'nodes', values, count: values.length }
  }
  return { ok: false, error: 'Unexpected XPath result type' }
}

function serializeNode(node: Node): string {
  // text nodes
  if (node.nodeType === 3 || node.nodeType === 4) return (node.nodeValue ?? '').toString()
  // attribute
  if (node.nodeType === 2) {
    const a = node as Attr
    return `${a.name}="${a.value}"`
  }
  // element / document — outerXML if available
  type WithOuter = Node & { outerHTML?: string; toString?: () => string }
  const n = node as WithOuter
  if (typeof n.outerHTML === 'string' && n.outerHTML) return n.outerHTML
  if (typeof n.toString === 'function') return n.toString()
  return String(node)
}
