# Yapılacaklar (Open TODOs)

Last updated: 2026-05-06

Bu dosya elle bakılan kısa liste. Detaylı sprint planlama
`docs/production-readiness/STATUS.md`'de.

---

## 🟢 Bu Oturumda Kapanan Bug'lar (2026-05-06)

- ✅ **WSDL multi-binding** — `soap.engine.ts` `parseWsdlXmlStructure` (fast-xml-parser ile portType/binding/service haritası); `client.describe()` ve XML kaynaklarının union'ı alınıyor (dneonline calculator: 2 → 4 op).
- ✅ **Form-data / urlencoded `{{var}}` resolve** — `resolveRequestBody` helper'ı `variable-resolver.ts`'e eklendi; `request.store.ts` artık `formData` rows + `urlEncoded` rows + `binaryPath`'i de resolve ediyor.
- ✅ **Postman v1 hata mesajı** — `info` yerine `requests[]` + top-level `name` görüldüğünde "v1 collections are not supported. Re-export as v2.1" diye açıklayıcı mesaj döner.
- ✅ **cURL ANSI-C quoting (`$'...'`)** — `tokenizeCurl` `\n` `\t` `\r` `\\` `\'` `\"` `\xNN`-altkümesi ve `\e`/`\E` escape'lerini decode ediyor.
- ✅ **cURL multipart `-F` file rows** — `parseCurlCommand` artık `formData: [{ key, value, type, filePath }]` üretir; `importCurl` UI shape body (`{ type: 'form-data', formData }`) yazar; `Content-Type` header importer tarafından setlenmiyor (HTTP client boundary'yi seçtiği için).
- ✅ **pm.environment / pm.globals post-script writeback** — `environment.store.applyScriptUpdates` eklendi; `request.store` post-script'in `_envUpdates` / `_globalUpdates` Map'lerini env store'a persist eder. Sonraki request token'ı görür.
- ✅ **EnvironmentSelector dropdown z-index** — `z-[9000]` → `z-[9999]`, NewDropdown / ToolsDropdown ile aynı katman.

## 🟡 Açık Bug'lar / Belirsiz

### Sağ overlay tıklanabilirlik (Bug 6)
- Detay yok; reproduction adımları gerek.
- Bu oturumda yapılan: EnvironmentSelector dropdown z-index `9999`'a çekildi (önceden `9000`, EnvironmentModal ile aynı katmandaydı). Eğer overlay EnvironmentSelector ise düzelmiş olabilir.
- **Test gerekli:** hangi panel hangi panelin arkasında kalıyor? Repro alındıktan sonra DevTools elements panelinde computed `z-index` ve `pointer-events` kontrolü.

---

## 🟡 Eksik / Düşük Öncelikli

### v1.0.4 kapsamından düşürülenler (Tier 2 — gelecek release)
- **MCP entegrasyonu** — Model Context Protocol client (stdio + Streamable HTTP transport, `tools/list`, `invokeTool`). Plan dosyasında detay.
- **Socket.IO entegrasyonu** — `socket.io-client`, namespace + auth, emit + subscribe, event timeline.
- **Test suite multi-format export** — şu an export sadece Testnizer-native; Postman/Insomnia formatına export desteklenmiyor (auto-detect import zaten implement edildi).

### Postman / cURL / OpenAPI roundtrip iyileştirmeleri
- **cURL exporter Windows `^"` carets** — best-effort, parser carets'leri value'da bırakıyor. Düşük öncelik.
- **Postman variables — globals scope** — şu an sadece active env emit ediliyor; global variables eklenmeli mi kararı (cross-collection leak riski). Açık soru.

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
