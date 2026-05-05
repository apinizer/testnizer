import { Xslt, XmlParser } from 'xslt-processor'

export type XsltResult = { ok: true; output: string } | { ok: false; error: string }

/**
 * Apply an XSLT 1.0 stylesheet to an XML document.
 * Powered by `xslt-processor` (XSLT 1.0). For 2.0+ workflows we'd need
 * SaxonJS — deferred until a concrete user request.
 */
export async function transformXslt(xml: string, xsl: string): Promise<XsltResult> {
  if (!xml?.trim()) return { ok: false, error: 'XML input is empty' }
  if (!xsl?.trim()) return { ok: false, error: 'XSL stylesheet is empty' }

  try {
    const xslt = new Xslt()
    const parser = new XmlParser()
    const xmlDoc = parser.xmlParse(xml)
    const xslDoc = parser.xmlParse(xsl)
    const output = await xslt.xsltProcess(xmlDoc, xslDoc)
    return { ok: true, output }
  } catch (e) {
    return {
      ok: false,
      error: 'XSLT transform error: ' + (e instanceof Error ? e.message : String(e)),
    }
  }
}
