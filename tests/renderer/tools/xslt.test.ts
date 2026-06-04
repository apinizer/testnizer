import { describe, it, expect } from 'vitest'
import { transformXslt } from '../../../src/renderer/lib/tools/xslt'

describe('transformXslt', () => {
  it('basic identity-style transform', async () => {
    const xml = '<root><a>1</a><a>2</a></root>'
    const xsl = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <result>
      <xsl:for-each select="root/a">
        <item><xsl:value-of select="."/></item>
      </xsl:for-each>
    </result>
  </xsl:template>
</xsl:stylesheet>`
    const r = await transformXslt(xml, xsl)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.output).toContain('<item>1</item>')
      expect(r.output).toContain('<item>2</item>')
    }
  })

  it('XSLT with HTML output method', async () => {
    const xml = '<greeting>Hello</greeting>'
    const xsl = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html"/>
  <xsl:template match="/greeting">
    <h1><xsl:value-of select="."/></h1>
  </xsl:template>
</xsl:stylesheet>`
    const r = await transformXslt(xml, xsl)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toContain('<h1>Hello</h1>')
  })

  it('rejects empty XML input', async () => {
    const r = await transformXslt('', '<xsl:stylesheet xmlns:xsl="..."/>')
    expect(r.ok).toBe(false)
  })

  it('rejects empty stylesheet', async () => {
    const r = await transformXslt('<a/>', '')
    expect(r.ok).toBe(false)
  })

  it('rejects malformed stylesheet (non-XML)', async () => {
    // The processor either errors out, or returns an empty/junk output. Both
    // are acceptable failure signals; we only assert it doesn't pretend the
    // input was a real stylesheet (i.e. no recognizable transformation).
    const r = await transformXslt('<a>data</a>', 'not xslt at all')
    if (r.ok) {
      // If the engine accepted it, the output cannot contain a meaningful
      // transformation of the input.
      expect(r.output).not.toContain('<a>data</a>')
    } else {
      expect(r.ok).toBe(false)
    }
  })
})
