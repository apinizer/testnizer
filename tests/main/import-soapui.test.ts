import { describe, it, expect } from 'vitest'
import { parseSoapUiProject } from '../../src/main/ipc/import-export.handler'

// Helper that builds a minimal SoapUI project XML so each test stays focused
// on the specific shape it cares about. We always use the `con:` prefix
// because that's what real SoapUI / ReadyAPI exports do.
function projectXml(body: string, projectName = 'TestProject'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<con:soapui-project xmlns:con="http://eviware.com/soapui/config" name="${projectName}">
${body}
</con:soapui-project>`
}

describe('parseSoapUiProject', () => {
  it('parses a minimal project with one interface, two operations, one call each', () => {
    const xml = projectXml(`
  <con:interface name="WeatherSoap" type="wsdl" definition="https://example.com/weather?wsdl">
    <con:operation name="GetTemperature" action="urn:GetTemperature" method="POST">
      <con:call name="Request 1">
        <con:endpoint>https://example.com/weather</con:endpoint>
        <con:request><![CDATA[<soapenv:Envelope><soapenv:Body><GetTemperature/></soapenv:Body></soapenv:Envelope>]]></con:request>
      </con:call>
    </con:operation>
    <con:operation name="GetForecast" action="urn:GetForecast" method="POST">
      <con:call name="Request 1">
        <con:endpoint>https://example.com/weather</con:endpoint>
        <con:request><![CDATA[<soapenv:Envelope><soapenv:Body><GetForecast/></soapenv:Body></soapenv:Envelope>]]></con:request>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)

    expect(parsed.projectName).toBe('TestProject')
    expect(parsed.interfaces).toHaveLength(1)

    const iface = parsed.interfaces[0]
    expect(iface.name).toBe('WeatherSoap')
    expect(iface.definition).toBe('https://example.com/weather?wsdl')
    expect(iface.operations).toHaveLength(2)

    const [opA, opB] = iface.operations
    expect(opA.name).toBe('GetTemperature')
    expect(opA.calls).toHaveLength(1)
    expect(opA.calls[0].endpointUrl).toBe('https://example.com/weather')
    expect(opA.calls[0].rawXml).toContain('<GetTemperature/>')

    expect(opB.name).toBe('GetForecast')
    expect(opB.calls[0].rawXml).toContain('<GetForecast/>')
  })

  it('produces one folder per <con:interface>', () => {
    const xml = projectXml(`
  <con:interface name="ServiceA" type="wsdl" definition="a.wsdl">
    <con:operation name="OpA" action="" method="POST">
      <con:call name="Req"><con:endpoint>http://a/</con:endpoint><con:request><![CDATA[<a/>]]></con:request></con:call>
    </con:operation>
  </con:interface>
  <con:interface name="ServiceB" type="wsdl" definition="b.wsdl">
    <con:operation name="OpB" action="" method="POST">
      <con:call name="Req"><con:endpoint>http://b/</con:endpoint><con:request><![CDATA[<b/>]]></con:request></con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)

    // Two interfaces => importSoapUi will create two folders. Verify that the
    // parser surfaces both rather than collapsing into one.
    expect(parsed.interfaces).toHaveLength(2)
    expect(parsed.interfaces.map((i) => i.name)).toEqual(['ServiceA', 'ServiceB'])
    expect(parsed.interfaces[0].definition).toBe('a.wsdl')
    expect(parsed.interfaces[1].definition).toBe('b.wsdl')
  })

  it('preserves the SOAPAction declared on the operation (action attribute)', () => {
    const xml = projectXml(`
  <con:interface name="S" definition="x.wsdl">
    <con:operation name="DoThing" action="urn:DoThing-Action" method="POST">
      <con:call name="Req">
        <con:endpoint>http://x</con:endpoint>
        <con:request><![CDATA[<env/>]]></con:request>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)
    const op = parsed.interfaces[0].operations[0]

    expect(op.soapAction).toBe('urn:DoThing-Action')
    // soapAction is also propagated into each call so the importer can build
    // the SOAPAction header without re-walking the parent.
    expect(op.calls[0].soapAction).toBe('urn:DoThing-Action')
  })

  it('also accepts the legacy soapAction attribute name', () => {
    // Older SoapUI exports use `soapAction` instead of `action`. We must
    // continue to read these so customers upgrading do not lose data.
    const xml = projectXml(`
  <con:interface name="S" definition="x.wsdl">
    <con:operation name="LegacyOp" soapAction="urn:Legacy" method="POST">
      <con:call name="Req">
        <con:endpoint>http://x</con:endpoint>
        <con:request><![CDATA[<env/>]]></con:request>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)
    expect(parsed.interfaces[0].operations[0].soapAction).toBe('urn:Legacy')
  })

  it('expands a call with multiple test request bodies into one entry per request', () => {
    // SoapUI lets users save several "test request" variants per operation. We
    // surface each variant as its own SoapUiCall (with a disambiguated name)
    // rather than dropping all but the first — keeps imported data lossless.
    const xml = projectXml(`
  <con:interface name="S" definition="x.wsdl">
    <con:operation name="Op" action="urn:Op" method="POST">
      <con:call name="Variants">
        <con:endpoint>http://x</con:endpoint>
        <con:request><![CDATA[<one/>]]></con:request>
        <con:request><![CDATA[<two/>]]></con:request>
        <con:request><![CDATA[<three/>]]></con:request>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)
    const calls = parsed.interfaces[0].operations[0].calls

    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.name)).toEqual([
      'Variants - request 1',
      'Variants - request 2',
      'Variants - request 3',
    ])
    expect(calls[0].rawXml).toContain('<one/>')
    expect(calls[1].rawXml).toContain('<two/>')
    expect(calls[2].rawXml).toContain('<three/>')
  })

  it('leaves single-request calls with their original name (no " - request 1" suffix)', () => {
    const xml = projectXml(`
  <con:interface name="S" definition="x.wsdl">
    <con:operation name="Op" action="" method="POST">
      <con:call name="Plain">
        <con:endpoint>http://x</con:endpoint>
        <con:request><![CDATA[<env/>]]></con:request>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)
    expect(parsed.interfaces[0].operations[0].calls[0].name).toBe('Plain')
  })

  it('handles a call with no <con:endpoint> by emitting an empty endpointUrl', () => {
    // Real-world SoapUI projects sometimes save calls without an endpoint
    // (e.g. relying on a property expansion). We must not crash; instead, we
    // emit '' so the importer can attach a warning and the user can fix it.
    const xml = projectXml(`
  <con:interface name="S" definition="x.wsdl">
    <con:operation name="Op" action="" method="POST">
      <con:call name="NoEndpoint">
        <con:request><![CDATA[<env/>]]></con:request>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)
    const call = parsed.interfaces[0].operations[0].calls[0]
    expect(call.endpointUrl).toBe('')
    expect(call.rawXml).toContain('<env/>')
  })

  it('handles a call with no <con:request> by emitting an empty rawXml', () => {
    const xml = projectXml(`
  <con:interface name="S" definition="x.wsdl">
    <con:operation name="Op" action="" method="POST">
      <con:call name="NoBody">
        <con:endpoint>http://x</con:endpoint>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)
    const call = parsed.interfaces[0].operations[0].calls[0]
    expect(call.rawXml).toBe('')
    expect(call.endpointUrl).toBe('http://x')
  })

  it('handles a request body that is plain text (no CDATA wrapping)', () => {
    // fast-xml-parser emits plain text under #text rather than #cdata. Our
    // reader must understand both shapes so non-canonical exports still work.
    const xml = projectXml(`
  <con:interface name="S" definition="x.wsdl">
    <con:operation name="Op" action="" method="POST">
      <con:call name="PlainText">
        <con:endpoint>http://x</con:endpoint>
        <con:request>just-text-no-cdata</con:request>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)
    expect(parsed.interfaces[0].operations[0].calls[0].rawXml).toBe('just-text-no-cdata')
  })

  it('throws a descriptive error when the root element is not a SoapUI project', () => {
    expect(() =>
      parseSoapUiProject(`<?xml version="1.0"?><not-a-project/>`),
    ).toThrowError(/SoapUI project file/)
  })

  it('returns zero interfaces when the project has none', () => {
    const xml = projectXml('')
    const parsed = parseSoapUiProject(xml)
    expect(parsed.interfaces).toHaveLength(0)
  })

  it('handles a single interface whose elements are scalar (fast-xml-parser collapse)', () => {
    // fast-xml-parser collapses single repeated children to scalars (rather than
    // 1-element arrays). We feed exactly one of every element through to make
    // sure asArray() coercion is wired everywhere.
    const xml = projectXml(`
  <con:interface name="Solo" definition="solo.wsdl">
    <con:operation name="OnlyOp" action="urn:Only" method="POST">
      <con:call name="OnlyCall">
        <con:endpoint>http://solo</con:endpoint>
        <con:request><![CDATA[<solo/>]]></con:request>
      </con:call>
    </con:operation>
  </con:interface>`)

    const parsed = parseSoapUiProject(xml)
    expect(parsed.interfaces).toHaveLength(1)
    expect(parsed.interfaces[0].operations).toHaveLength(1)
    expect(parsed.interfaces[0].operations[0].calls).toHaveLength(1)
    expect(parsed.interfaces[0].operations[0].calls[0].rawXml).toContain('<solo/>')
  })
})
