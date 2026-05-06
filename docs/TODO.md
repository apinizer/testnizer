# Yapılacaklar (Open TODOs)

Last updated: 2026-05-06

Bu dosya elle bakılan kısa liste. Detaylı sprint planlama
`docs/production-readiness/STATUS.md`'de.

---

## 🔴 Açık Bug'lar

### WSDL Parser — multi-binding operasyon kaybı
- **Repro:** http://www.dneonline.com/calculator.asmx?wsdl içe aktarıldığında 4 operasyondan (Add/Subtract/Multiply/Divide) sadece 2'si gözüküyor.
- **Olası kök neden:** WSDL'de aynı portType'a iki binding (SOAP 1.1 + SOAP 1.2) bağlı; `soap` library'sinin `client.describe()` outputu beklenenden farklı olabilir.
- **Çözüm yolu:** `parseWsdl` içindeki `client.describe()` bağımlılığını kaldır → `wsdl.xml`'i `fast-xml-parser` ile direkt parse et, portType'ları kaynak olarak kullan.
- **Yer:** `src/main/protocols/soap.engine.ts:269-329`
- **Status:** Agent content-filter'a takıldı, manuel çözüm gerekiyor.

### Sağ overlay tıklanabilirlik (Bug 6)
- Önceki bir konuşmada bahsedildi, detay tutmadık. UI'da bir overlay/modal başka panelin arkasında kalıyor.
- **Yer:** araştırma gerekiyor; muhtemelen `EnvironmentSelector` veya `NewDropdown` benzeri bir createPortal noktası.

---

## 🟡 Eksik / Düşük Öncelikli

### v1.0.4 kapsamından düşürülenler (Tier 2 — gelecek release)
- **MCP entegrasyonu** — Model Context Protocol client (stdio + Streamable HTTP transport, `tools/list`, `invokeTool`). Plan dosyasında detay.
- **Socket.IO entegrasyonu** — `socket.io-client`, namespace + auth, emit + subscribe, event timeline.
- **Test suite multi-format export** — şu an export sadece Testnizer-native; Postman/Insomnia formatına export desteklenmiyor (auto-detect import zaten implement edildi).

### Postman / cURL / OpenAPI roundtrip iyileştirmeleri
- **Postman v1 (legacy collection)** — şu an "Not a valid Postman collection" hatası ile düşürüyor; daha açıklayıcı mesaj veya v1→v2.1 migration shim.
- **cURL ANSI-C `$'...'` quoting** — `tokenizeCurl` `\n`/`\t` kaçışlarını decode etmiyor. Düşük öncelik.
- **cURL multipart `-F` import** — file rows hâlâ `body` string'inde `&`-joined; KeyValuePair `{type:'file', filePath}` rows'a parse edilmesi gerek (curl agent low-priority defer etti).
- **cURL exporter Windows `^"` carets** — best-effort, parser carets'leri value'da bırakıyor.
- **Postman variables — globals scope** — şu an sadece active env emit ediliyor; global variables eklenmeli mi kararı (cross-collection leak riski).

### Variable resolution (Tier 2 audit findings)
- HTTP body `form-data` ve `urlencoded` rows'da `{{var}}` hâlâ resolve edilmiyor — sadece `raw` body'de çalışıyor.
- Pre/post script context'ine `pm.variables.get/set` API'sinin in-memory persistence'ı eksik (response sonrası env'e geri yazma).

### Test kapsamı
- **Endpoint CRUD/handler unit testleri** — `endpoint.handler.ts`, `endpoint.repo.ts` için doğrudan test yok (sadece üst seviye import-export testleri dolaylı kapsıyor).
- **TLS test endpoint'leri** — apinizer.com endpoint listesi (`https://service.apinizer.com/...`) için yazılan testler agent worktree'sinde kaybolmuştu, yeniden başlatılması gerekebilir.
- **WSDL parse smoke test** — yukarıdaki bug fix'inden sonra dneonline calculator için 4-op smoke test eklenmeli.

---

## 🟢 Push / Release

### Origin'in 26 commit önündeyiz (push edilmedi)
```
9810be8  fix(import): escape ' in cURL export and auto-set Content-Type for -d
0fe0a7e  fix(import-proto): emit JSON skeleton with zero-valued fields for gRPC requests
131b452  fix(export): round-trip OpenAPI tags, operationId, security, params, body
1cba100  fix(postman): persist + emit collection.variable[] for lossless round-trip
4f8debe  fix(import): OpenAPI prefers content example over JSON-Schema dump
5dc26dc  fix(import): map OpenAPI security schemes into request auth
df68f36  fix(import): OpenAPI path keying + Postman script export + WSDL protocol
4bf360a  test: import format coverage (postman/curl/insomnia + Postman export)
d2e467d  feat(import): wire SoapUI project import end-to-end
6fb4b1a  feat(import): accept Postman + Insomnia for test suite import
ec5a91f  feat(import): wire .proto file dispatch in ImportModal + add importProto tests
0e516f3  test: add OpenAPI/Swagger import + export round-trip coverage
c855388  feat(import): RAML 1.0 import support (+ cURL/Insomnia fixes + parseSoapUiProject)
aa1bf10  feat(ai): refresh model lists to current (Jan 2026) catalog
84782cf  feat(ai): expand to 14 providers with brand-letter avatars
59bf805  fix(body): wire binary file picker + add DialogApi typing
13cfa5d  fix: variable resolution coverage across all protocols
b41b74b  Merge: Postman-style detailed console log
432ec43  Merge: AI Chat editor with streaming providers
7dde715  Merge: HTTP form-data file upload (Postman-style)
629f9bc  v1.0.3 UI fixes: tools sidebar, env portal, tab context menu
... ve daha öncesi
```

**Yapılacaklar:**
- [ ] WSDL bug fix (yukarıda)
- [ ] `npm version patch` ile v1.0.3 etiketi (CI'ı tetiklemek için)
- [ ] Tag push (`! git push origin main --follow-tags`)
- [ ] CI'ın 6 platform build'ini bekle (~15 dk)
- [ ] testnizer-releases'da draft release otomatik oluşur — kullanıcı manuel publish

### testnizer-releases repo README
- `docs/RELEASES_README.md` hazır — manuel olarak `apinizer/testnizer-releases` repo'sunun kök README.md'sine kopyala ve push et.
- Releases repo'sunda releases dışı içerik yok, bu README ana sayfa olacak.

---

## 📊 Durum

| Metric | Önceki | Şimdi |
|---|---|---|
| Test sayısı | 387 | 548 |
| Test dosyası | 20 | 29 |
| Commit (origin'den) | 5 | 26 |

| İmport formatı | Status |
|---|---|
| OpenAPI 3.x / Swagger 2.0 | ✅ tam (security schemes + examples + round-trip) |
| Postman v2.1 | ✅ tam (scripts + variables + round-trip) |
| Insomnia v4 | ✅ tam (file fields + script shim + envs) |
| cURL | ✅ tam (40+ flag, escape, round-trip) |
| WSDL | ⚠️ multi-binding bug açık |
| `.proto` (gRPC) | ✅ tam (skeleton bodies) |
| RAML 1.0 | ✅ minimal-but-honest |
| SoapUI / ReadyAPI | ✅ basic |
| HAR | ✅ |

---

## 📝 Notlar

- 5 paralel agent çalıştırma deneyimi başarılı: 4/5 tamamlandı, content-filter'a takılan WSDL agent'ı sade prompt ile yeniden çalıştırılabilir.
- Worktree-based izolasyon merge çakışmalarını çoğunlukla küçük tutuyor — ana repo'da editor olduğu sürece commit'i ana repo'ya yapan agent'lar çakışmaya yol açıyor (deniyim: agent'a "kendi worktree'inde commit yap" demek yetmiyor, mutlaka isolation: 'worktree' geçilmeli).
- Linter pre-commit hook executable değil; `chmod +x .husky/pre-commit` kullanıcı tercihiyle aktif edilebilir.
