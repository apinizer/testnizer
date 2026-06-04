---
title: SOAP
description: Parse WSDL files, generate envelopes automatically, and send SOAP 1.1 and 1.2 requests — all offline.
order: 6
section: Protocols
---

Testnizer's SOAP editor is built on the `soap` npm library (v1.9) with `wsse`
for security headers. WSDL parsing, envelope generation, and request execution
all run in the Node main process — no proxy, no cloud service.

## Opening a SOAP tab

Click **+ New** → **SOAP**. The editor opens with a mode picker: start from
WSDL or write an envelope manually.

## Starting from WSDL

### Load the WSDL

Provide a WSDL source in one of two ways:

- **URL**: paste the WSDL endpoint URL (e.g. `https://api.example.com/PaymentService?wsdl`)
  and click **Load**. Testnizer fetches the file over the main process — the
  renderer never touches the network.
- **File**: click **Load from file** and pick a `.wsdl` or `.xml` file from
  disk. Useful for offline environments or versioned WSDLs checked into a repo.

After loading, Testnizer parses services, ports, and operations. Any imported
schemas (`<xsd:import>` / `<wsdl:import>`) are resolved relative to the base
URL or file path.

### Navigate services and operations

Three dropdowns appear in the editor toolbar:

1. **Service** — one entry per `<wsdl:service>` element
2. **Port** — ports for the selected service
3. **Operation** — available operations on the selected port

Pick an operation and click **Generate envelope**. Testnizer builds a skeleton
request envelope from the operation's input message schema — complex types are
expanded, required elements are included, optional elements are shown commented
out.

Example generated envelope for a `GetAccountBalance` operation:

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
    xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:tns="http://banking.example.com/accounts">
  <soap:Header/>
  <soap:Body>
    <tns:GetAccountBalance>
      <tns:AccountId><!-- string --></tns:AccountId>
      <tns:Currency><!-- string --></tns:Currency>
    </tns:GetAccountBalance>
  </soap:Body>
</soap:Envelope>
```

Edit the skeleton directly in the Monaco envelope editor. The endpoint URL and
`SOAPAction` header are pre-filled from the WSDL binding.

## Manual mode

Click **Manual** at the top of the editor to skip WSDL loading and write the
envelope from scratch. Use this when:

- The WSDL is unavailable or locked behind a VPN you can't reach from the dev machine
- The service predates WSDL or uses a non-standard binding
- You captured a raw envelope from a network trace and want to replay or modify it

The Monaco editor is pre-seeded with a minimal envelope template:

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
    xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <!-- paste or write your request element here -->
  </soap:Body>
</soap:Envelope>
```

Fill in the namespace declarations and body element, set the endpoint URL, and
send.

## SOAP 1.1 vs 1.2

Use the **Version** toggle in the editor toolbar to switch between SOAP 1.1 and
SOAP 1.2. The differences Testnizer handles for you:

| | SOAP 1.1 | SOAP 1.2 |
|---|---|---|
| Envelope namespace | `http://schemas.xmlsoap.org/soap/envelope/` | `http://www.w3.org/2003/05/soap-envelope` |
| Content-Type | `text/xml; charset=utf-8` | `application/soap+xml; charset=utf-8` |
| SOAPAction header | Required (can be empty string) | Moved into Content-Type `action` parameter |
| Fault structure | `<faultcode>` / `<faultstring>` | `<Code>` / `<Reason>` |

When you switch versions on a WSDL-loaded request, Testnizer regenerates the
envelope namespace and updates the Content-Type automatically.

## Request tabs

### Action URL

Overrides the endpoint URL taken from the WSDL or entered manually. Useful
when the WSDL lists a production endpoint but you want to target a staging
environment — or when the service is behind a gateway at a different path.

Variables resolve in the URL field:

```
{{soapGatewayUrl}}/PaymentService
```

### Custom Headers

Add or override HTTP headers sent with the SOAP request. Common uses:

- `Authorization: Bearer {{accessToken}}` (when the service sits behind an OAuth gateway)
- `X-Correlation-ID: {{$randomUUID}}`
- Custom proxy headers

### SOAPAction override

By default, Testnizer sets the `SOAPAction` header from the WSDL binding or
leaves it blank for SOAP 1.2. To override it explicitly, enter the action URI
in this field.

Some services require an exact SOAPAction string that differs from what the
WSDL specifies — particularly older Microsoft WCF services.

## WS-Security

Open the **WS-Security** tab in the request editor to add message-level
security headers: UsernameToken (Text and Digest), Timestamp, XML Signature,
and XML Encryption.

See the full guide at [/docs/ws-security](/docs/ws-security).

## Response view

### Raw XML

The unmodified response body as received — byte-for-byte, including whitespace
and encoding declarations. Use this when you suspect a gateway is modifying the
envelope in transit.

### Pretty-printed

The same XML formatted with consistent indentation. Namespace prefixes are
normalized and the structure is easier to read.

### XPath query panel

Type an XPath expression in the query bar and Testnizer evaluates it against
the response document. Results are highlighted inline and listed below the
query bar.

Common patterns:

```xpath
//soap:Body/*                         (select everything in the body)
//tns:AccountBalance/text()           (extract a text value)
//*[local-name()='Fault']             (find faults regardless of namespace prefix)
```

Namespace prefixes in XPath expressions are resolved against the namespaces
declared in the response document.

## Common issues

### HTTP 500 vs SOAP Fault

A `500 Internal Server Error` HTTP status with a SOAP Fault body is valid SOAP
1.1 — the service processed the request and returned a structured error. This
is different from a `500` caused by a network or infrastructure failure.

Testnizer distinguishes them: if the response body parses as a valid SOAP
envelope containing a `<Fault>` element, the response pane shows the fault
code and message in a dedicated banner above the XML viewer, even when the HTTP
status is 500.

If the body is not parseable as SOAP (plain HTML error page, empty body), the
response pane shows the raw HTTP error without a fault banner.

### Missing SOAPAction header

Many SOAP 1.1 services reject requests with a missing or incorrect `SOAPAction`
header with a vague `400 Bad Request` or `500` response. If you get an
unexpected error from a WSDL-loaded request, check the **Console** tab to
confirm the `SOAPAction` header was included. If the WSDL binding omits the
action, set it explicitly in the SOAPAction override field.

### Character encoding

Testnizer sends requests as `charset=utf-8` by default. If the service returns
an encoding error or garbled characters, check whether it expects a different
encoding (common with legacy IBM or SAP ABAP services). Override the
`Content-Type` header in the Custom Headers tab to specify a different charset.
