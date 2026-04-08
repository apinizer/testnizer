package com.apinizer.manager.service.util.parsers;

/**
 * REFERENCE ONLY — Apinizer production SOAP/WSDL parser.
 * Node.js SOAP engine implement edilirken referans alınır.
 * Port mapping için bkz: .claude/agents/protocol-engine.md
 *
 * Kritik metodlar:
 * - findAllSchemasResursively(): XSD import zinciri recursive takibi
 * - resolveSchemaUrl(): Relative URL → absolute URL çözümleme
 * - normalizeLocation(): URL normalizasyon
 * - servers(): SOAP 1.1 / 1.2 / HTTP versiyon tespiti
 * - exampleRequestForOperation(): Örnek SOAP request XML üretimi
 * - exampleResponseForOperation(): Örnek SOAP response XML üretimi
 */
public class ConverterWSDL implements Serializable {

    // WSDL'den operasyon listesi çıkarma
    private SpecPaths paths(WsdlInterface iface) throws Exception {
        SpecPaths specPaths = new SpecPaths();
        for (com.eviware.soapui.model.iface.Operation oper : iface.getOperationList()) {
            // Her operasyon için POST path oluştur (SOAP her zaman POST)
            specPaths.put("/" + oper.getName(), path);
        }
        return specPaths;
    }

    // SOAP versiyon tespiti — Node.js'te WSDL namespace'inden yapılacak
    private List<SpecServer> servers(Service service) {
        for (Object ls : value.getExtensibilityElements()) {
            if (ls instanceof SOAPAddressImpl) {
                specServer.setSoapType(EnumSoapApiPortType.SOAP11); // text/xml
            }
            if (ls instanceof SOAP12AddressImpl) {
                specServer.setSoapType(EnumSoapApiPortType.SOAP12); // application/soap+xml
            }
            if (ls instanceof HTTPAddressImpl) {
                specServer.setSoapType(EnumSoapApiPortType.HTTP);
            }
        }
    }

    // KRİTİK: XSD import zinciri recursive takibi
    // Node.js'te birebir port edilmeli
    private void findAllSchemasResursively(
        List<SoapSchema> schemaList,
        String schemaBody,
        int[] schemaNoCounter,
        boolean fromFile,
        String parentUrl,
        Set<String> resolvedLocations  // duplicate önleme
    ) {
        // 1. xsd:import/@schemaLocation XPath ile bul
        List<String> xsdUrls = extractListFromXmlBody(schemaBody,
            "//*[translate(local-name(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='import']/@schemaLocation",
            true);

        for (String oldXsdUrl : xsdUrls) {
            // 2. Relative → absolute URL resolve
            String resolvedUrl = resolveSchemaUrl(oldXsdUrl, parentUrl);
            String normalized = normalizeLocation(resolvedUrl);

            // 3. Duplicate kontrolü
            if (resolvedLocations.contains(normalized)) continue;
            resolvedLocations.add(normalized);

            // 4. HTTP veya dosyadan içeriği çek
            String xsdContent = fetchContent(resolvedUrl, fromFile);

            // 5. Schema listesine ekle
            SoapSchema schema = new SoapSchema();
            schema.setSchemaBody(xsdContent);
            schemaList.add(schema);

            // 6. Recurse
            findAllSchemasResursively(schemaList, xsdContent, schemaNoCounter,
                fromFile, resolvedUrl, resolvedLocations);
        }
    }

    // Node.js karşılığı: new URL(schemaLocation, parentUrl).toString()
    private String resolveSchemaUrl(String schemaLocation, String parentUrl) {
        if (schemaLocation başlıyorsa http/https/file) return schemaLocation;
        URL parent = new URI(parentUrl).toURL();
        return parent.toURI().resolve(schemaLocation).toURL().toString();
    }

    // Node.js karşılığı: location.toLowerCase().replace(/\\/g, '/')
    private String normalizeLocation(String location) {
        return location.toLowerCase().replace("\\", "/");
    }
}
