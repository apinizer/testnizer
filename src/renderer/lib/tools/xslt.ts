import { Xslt, XmlParser } from 'xslt-processor'

export type XsltResult = { ok: true; output: string } | { ok: false; error: string }

/**
 * Apply an XSLT 1.0 stylesheet to an XML document.
 * Powered by `xslt-processor` (XSLT 1.0). For 2.0+ workflows we'd need
 * SaxonJS — deferred until a concrete user request.
 */
export interface XsltExample {
  label: string
  xml: string
  xsl: string
}

const XSL_HEAD =
  '<?xml version="1.0"?>\n<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">\n  <xsl:output method="xml" indent="yes"/>'

const SAMPLE_XML_BOOK = `<?xml version="1.0"?>
<catalog>
  <book id="b1">
    <title>Sayings</title>
    <author>Nigel Rees</author>
    <price>8.95</price>
  </book>
  <book id="b2">
    <title>Moby Dick</title>
    <author>Herman Melville</author>
    <price>8.99</price>
  </book>
</catalog>`

const SAMPLE_SOAP = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://example.com/ws">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:GetCustomer>
      <ws:CustomerId>C-1001</ws:CustomerId>
      <ws:Name>Alice</ws:Name>
    </ws:GetCustomer>
  </soapenv:Body>
</soapenv:Envelope>`

const SAMPLE_NESTED = `<?xml version="1.0"?>
<order>
  <customer><id>C-1</id><name>Alice</name></customer>
  <items>
    <item><sku>A1</sku><qty>2</qty></item>
    <item><sku>B2</sku><qty>1</qty></item>
  </items>
</order>`

export const XSLT_EXAMPLES: XsltExample[] = [
  {
    label: '1. Extract the value of the selected element',
    xml: SAMPLE_XML_BOOK,
    xsl: `${XSL_HEAD}
  <xsl:template match="/">
    <result>
      <xsl:value-of select="/catalog/book[1]/title"/>
    </result>
  </xsl:template>
</xsl:stylesheet>`,
  },
  {
    label: '2. Creating a new XML',
    xml: SAMPLE_XML_BOOK,
    xsl: `${XSL_HEAD}
  <xsl:template match="/">
    <bookList>
      <xsl:for-each select="catalog/book">
        <book>
          <xsl:attribute name="id"><xsl:value-of select="@id"/></xsl:attribute>
          <name><xsl:value-of select="title"/></name>
          <by><xsl:value-of select="author"/></by>
        </book>
      </xsl:for-each>
    </bookList>
  </xsl:template>
</xsl:stylesheet>`,
  },
  {
    label: '3. Convert XML request to SOAP request',
    xml: `<?xml version="1.0"?>
<GetCustomer xmlns="http://example.com/ws">
  <CustomerId>C-1001</CustomerId>
  <Name>Alice</Name>
</GetCustomer>`,
    xsl: `${XSL_HEAD}
  <xsl:template match="/">
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      <soapenv:Header/>
      <soapenv:Body>
        <xsl:copy-of select="*"/>
      </soapenv:Body>
    </soapenv:Envelope>
  </xsl:template>
</xsl:stylesheet>`,
  },
  {
    label: '4. Changing the name of an element in the SOAP Body',
    xml: SAMPLE_SOAP,
    xsl: `${XSL_HEAD}
  <xsl:template match="/">
    <xsl:copy>
      <xsl:apply-templates/>
    </xsl:copy>
  </xsl:template>
  <xsl:template match="*[local-name()='GetCustomer']">
    <xsl:element name="FetchCustomer" namespace="{namespace-uri()}">
      <xsl:apply-templates/>
    </xsl:element>
  </xsl:template>
  <xsl:template match="@*|node()">
    <xsl:copy>
      <xsl:apply-templates select="@*|node()"/>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>`,
  },
  {
    label: '5. Getting SOAP Body content',
    xml: SAMPLE_SOAP,
    xsl: `${XSL_HEAD}
  <xsl:template match="/">
    <xsl:copy-of select="//*[local-name()='Body']/*"/>
  </xsl:template>
</xsl:stylesheet>`,
  },
  {
    label: '6. Copy an element into another element',
    xml: SAMPLE_NESTED,
    xsl: `${XSL_HEAD}
  <xsl:template match="/">
    <enrichedOrder>
      <xsl:copy-of select="order/customer"/>
      <summary>
        <xsl:copy-of select="order/items"/>
      </summary>
    </enrichedOrder>
  </xsl:template>
</xsl:stylesheet>`,
  },
  {
    label: '7. Changing the name of an element of Nested Body',
    xml: SAMPLE_NESTED,
    xsl: `${XSL_HEAD}
  <xsl:template match="/">
    <xsl:copy>
      <xsl:apply-templates/>
    </xsl:copy>
  </xsl:template>
  <xsl:template match="item">
    <product>
      <xsl:apply-templates/>
    </product>
  </xsl:template>
  <xsl:template match="@*|node()">
    <xsl:copy>
      <xsl:apply-templates select="@*|node()"/>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>`,
  },
  {
    label: '8. Manually adding a value to the SOAP header',
    xml: SAMPLE_SOAP,
    xsl: `${XSL_HEAD}
  <xsl:template match="/">
    <xsl:copy>
      <xsl:apply-templates/>
    </xsl:copy>
  </xsl:template>
  <xsl:template match="*[local-name()='Header']">
    <xsl:copy>
      <AuthToken>BEARER-XYZ</AuthToken>
      <xsl:apply-templates select="*"/>
    </xsl:copy>
  </xsl:template>
  <xsl:template match="@*|node()">
    <xsl:copy>
      <xsl:apply-templates select="@*|node()"/>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>`,
  },
]

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
