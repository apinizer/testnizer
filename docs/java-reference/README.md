# Java Referans — SOAP/WSDL Parser

`ConverterWSDL.java` Apinizer'ın production SOAP parse kodu.
Node.js SOAP engine implement edilirken referans alınır.

## Kritik Metodlar

| Java Metodu | Amaç | Node.js Portu |
|---|---|---|
| `convertFromUrl()` | URL'den WSDL parse | `soap.createClientAsync(url)` |
| `iface.getOperationList()` | Tüm operasyonlar | `client.describe()` |
| `paths()` | Her operasyon → path/request | Mapping logic |
| `servers()` | SOAP 1.1/1.2/HTTP tespit | namespace'den tespit |
| `soapSchemaList()` | XSD listesi çıkarma | Aşağıda |
| `findAllSchemasResursively()` | Recursive XSD import | **KRİTİK PORT** |
| `resolveSchemaUrl()` | Relative → absolute URL | `new URL(loc, parent)` |
| `normalizeLocation()` | URL normalize | `.toLowerCase().replace(\\,/)` |
| `exampleRequestForOperation()` | Örnek request XML | Schema'dan envelope build |
| `exampleResponseForOperation()` | Örnek response XML | Output schema'dan |

## `findAllSchemasResursively()` Detaylı Port

Java kodunun yaptığı:
1. XML'i parse et, `xsd:import/@schemaLocation` elementlerini XPath ile bul
2. Her URL için `resolveSchemaUrl(oldXsdUrl, parentUrl)` → absolute URL
3. `normalizeLocation(resolved)` → Set'e bak, varsa atla (duplicate önleme)
4. HTTP URL → axios.get; file URL → fs.readFile
5. SoapSchema nesnesine ekle
6. Recurse: `findAllSchemasResursively(content, resolvedUrl, ...)`

Node.js implementasyonunda `fast-xml-parser` ile XPath benzeri işlem yapılır.

## SOAP Versiyon Tespiti (Java `servers()` metodu)

```java
if (ls instanceof SOAPAddressImpl)   → SOAP11 → text/xml
if (ls instanceof SOAP12AddressImpl) → SOAP12 → application/soap+xml
if (ls instanceof HTTPAddressImpl)   → HTTP
```

Node.js'te WSDL binding namespace'inden tespit:
- `http://schemas.xmlsoap.org/wsdl/soap/`   → SOAP 1.1
- `http://schemas.xmlsoap.org/wsdl/soap12/` → SOAP 1.2
