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

/** Canonical sample document used by the XPath examples below. */
export const XPATH_SAMPLE_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<bookstore>
  <book id="bk101" category="reference">
    <title lang="en">XPath Reference</title>
    <author>Nigel Rees</author>
    <price>9.99</price>
  </book>
  <book id="bk111" category="cooking">
    <title lang="en">Everyday Italian</title>
    <author>Giada De Laurentiis</author>
    <price>30.00</price>
  </book>
  <book id="bk201" category="fiction">
    <title lang="fr">Les Misérables</title>
    <author>Victor Hugo</author>
    <price>40.00</price>
  </book>
  <book id="bk301" category="fiction">
    <title lang="en">Harry Potter</title>
    <author>J K. Rowling</author>
    <price>29.99</price>
  </book>
  <inventory>
    <snack>
      <price>2.50</price>
    </snack>
  </inventory>
  <items>
    <item productID="A1"><price>5</price><quality>3</quality></item>
    <item productID="B2"><price>2</price><quality>9</quality></item>
    <item productID="C3"><price>1.5</price><quality>7</quality></item>
  </items>
  <students>
    <student gender="Female"><name>Alice</name></student>
    <student gender="Male"><name>Bob</name></student>
  </students>
</bookstore>`

export interface XPathExample {
  label: string
  expression: string
  /** Optional document — when picked, replaces the document too. */
  xml?: string
}

export const XPATH_EXAMPLES: XPathExample[] = [
  { label: '1. The first book', expression: '/bookstore/book[1]', xml: XPATH_SAMPLE_DOC },
  {
    label: '2. Currency of the book whose price is more than 35',
    expression: '/bookstore/book[price>35]/title/@lang',
    xml: XPATH_SAMPLE_DOC,
  },
  { label: '3. Item in the current node set', expression: '//item', xml: XPATH_SAMPLE_DOC },
  {
    label: '4. Title elements with lang="en"',
    expression: '//title[@lang="en"]',
    xml: XPATH_SAMPLE_DOC,
  },
  {
    label: '5. Price of the snack child of inventory',
    expression: '/bookstore/inventory/snack/price',
    xml: XPATH_SAMPLE_DOC,
  },
  {
    label: '6. Author of the book whose price is less than 30',
    expression: '/bookstore/book[price<30]/author',
    xml: XPATH_SAMPLE_DOC,
  },
  { label: '7. The last book', expression: '/bookstore/book[last()]', xml: XPATH_SAMPLE_DOC },
  {
    label: '8. Penultimate book',
    expression: '/bookstore/book[last()-1]',
    xml: XPATH_SAMPLE_DOC,
  },
  {
    label: '9. The price of the book whose id is bk111',
    expression: '/bookstore/book[@id="bk111"]/price',
    xml: XPATH_SAMPLE_DOC,
  },
  {
    label: '10. ProductID where price < 3 and quality > 5',
    expression: '//item[price<3 and quality>5]/@productID',
    xml: XPATH_SAMPLE_DOC,
  },
  {
    label: '11. Name of student whose gender is not "Male"',
    expression: '//student[@gender!="Male"]/name',
    xml: XPATH_SAMPLE_DOC,
  },
]

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
