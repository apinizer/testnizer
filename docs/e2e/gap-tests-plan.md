# Gap Tests Plan — manuel checklist'ten çıkan otomasyon boşlukları (MST-301..314)

Kaynak: `~/Downloads/manual-test-checklist.md` (v1.3.0 manuel checklist) ile mevcut
suite'in (663 UI E2E + 1689 vitest) karşılaştırması, 2026-06-08.
Numara bloğu: **MST-301+** — `ext/tur1/tests-list.txt` master planı 292'de bitiyor,
çakışma yok. Tüm yeni spec'ler `tests/e2e/ui/tur1/` altında, `uiTest` + standart
beforeEach guard (`dismissOverlays + ensureCanonicalProject + navigateSidebar`) ile.

## Önceden doğrulanan feature varlığı (test yazmadan önce grep'lendi)

| Özellik | Kanıt |
|---|---|
| `export:insomnia` IPC | `src/main/ipc/import-export.handler.ts:415` |
| Mock proxy record | `src/main/mock/proxy.ts:11` (recorder yeni mock endpoint persist eder) |
| PFX/PKCS12 + passphrase | `certificate.repo.ts`, `http.engine.ts`; fixture: `tests/fixtures/certs/client.p12`, `bad.p12` |
| Auth eye toggle | `src/renderer/components/request/AuthTab.tsx:66` (Eye/EyeOff) |
| Header autocomplete logic | `src/renderer/components/shared/KeyValueTable.tsx` + `lib/http-headers.ts` |
| Actual tab | `ResponsePane.tsx:370` `res-tab-${tab.key}` → `res-tab-actualRequest` |
| About i18n | `lib/i18n.ts` `about.*` keyleri |
| Suite item rename | `TestsPanel.tsx:70+` |

**Feature YOK (test yazılmayacak, checklist düzeltmesi):** UI auth listesi yalnız
`noAuth/basic/bearer/apiKey/digest/oauth2/ntlm/wsse` — OAuth1, Hawk, AWS yok.
Checklist v1.3.0'daki Auth satırı güncel uygulamayla uyumsuz.

## Test listesi

### A — Headers autocomplete (R-8/R-9) → `headers-autocomplete.spec.ts`
- **MST-301 (P0)** Key autocomplete: Headers tab'da boş satır key hücresine `cont`
  yaz → öneri paneli görünür → `Content-Type` önerisine tıkla → key dolar.
- **MST-302 (P0)** Value autocomplete: `Content-Type` satırının value hücresine
  focus (boş value) → öneriler görünür (`application/json` dahil) → `json` yazınca
  filtrelenir → seçim value'yu doldurur.
- **MST-303 (P1)** Variable autocomplete: value hücresinde `{{` yazınca aktif env
  variable'ları listelenir → seçim `{{var}}` ekler.
- Gerekirse `KeyValueTable.tsx`'e minimal `data-testid` hook'ları (öneri paneli +
  öneri item'ları) eklenebilir — davranış değişikliği yasak.

### B — Actual request sert assert → `actual-request-tab.spec.ts`
> **İmplementasyon keşfi:** "Actual Request" TAB'ı `ResponsePane.tsx`'ten bilinçli
> kaldırılmış (satır ~326 yorumu); resolved request verisi artık footer **Console**
> panel detayında yaşıyor (`request.handler.ts` → `logRequestResponse`). Testler bu
> gerçek yüzeyi hedefler; `actual-request-panel` testid'i `ConsoleTab.tsx`'in detay
> container'ına eklendi (tier14 MST-286'nın yumuşak locator'ı da artık gerçek hedef
> buluyor). Checklist'in "Actual tab" maddesi v1.3.0'a ait — güncel UI'da tab yok.
- **MST-304 (P0)** `{{var}}` URL + custom header ile Send → Console detayında
  resolved URL + header görünür, `{{` içermez (sert assert).
- **MST-305 (P1)** URL credentials (`user:secret@`) Console detayında maskeli —
  tier14 MST-286'nın if-visible'sız sert versiyonu (o test olduğu gibi kaldı).

### C — Auth UI tipleri + eye toggle → `auth-ui-types.spec.ts`
- **MST-306 (P0)** `apiKey`, `digest`, `oauth2` UI'dan seçilebilir; tipe özgü
  alanlar render olur; apiKey alanları doldur + kaydet + tab kapat/aç → korunur.
  (basic/bearer/noAuth/ntlm zaten E2E'de var — tekrarlama yok.)
  **İmplementasyon keşfi:** `wsse` pill'i SOAP-only — HTTP tab'da render edilmiyor;
  ayrı bir testte HTTP'de yokluğu + SOAP tab'ında seçilebilirliği assert edilir.
- **MST-307 (P1)** Basic auth password eye toggle: `type=password` → Eye tıkla →
  `type=text` → tekrar → `password`.

### D — Mock CORS davranışı → `mock-cors.spec.ts`
- **MST-308 (P0)** CORS enabled mock server'a OPTIONS preflight (test process'ten
  node http ile) → `Access-Control-Allow-Origin/Methods` döner; CORS disabled
  server'da bu header'lar yok. Önce `src/main/mock/server.ts` CORS dalını oku.

### E — Mock proxy record → `mock-proxy-record.spec.ts`
- **MST-309 (P1)** Proxy + record açık mock → upstream'e düşen istek sonrası
  yakalanan response yeni mock endpoint olarak persist edilir (mock IPC list ile
  doğrula). `mock-proxy.spec.ts` MST-169 pattern'ini baz al.

### F — Export → Insomnia → `tests/main/export-insomnia.test.ts` + `export-insomnia-ui.spec.ts`
- **MST-310 (P1)** E2E: `export:insomnia` IPC çağrısı Insomnia formatında JSON
  döner (`export-postman-ui.spec.ts` MST-093 paritesi). Unit: exporter çıktı şekli
  (resources, _type, method/url eşlemesi) — handler implementasyonuna göre yaz.

### G — About i18n regression (R-2) → `about-i18n.spec.ts`
- **MST-311 (P1)** About tab'ı aç → görünen metinlerde `/^about\./` pattern'inde
  ham i18n key YOK; "Application version, runtime and license info." görünür;
  VERSION/PLATFORM/ELECTRON grid satırları insan-okunabilir.

### H — Suite item rename → `suite-item-rename.spec.ts`
- **MST-312 (P1)** Suite + item oluştur → context menu Rename → yeni ad → tree'de
  görünür + IPC list'te persist. `suite-flow.ts` helper'larını
  (`clickSuiteContextMenuItem` dispatchEvent pattern'i) kullan.

### I — PFX/PKCS12 sertifika → `14-certificates-mtls.spec.ts`'e ek veya `cert-pfx.spec.ts`
- **MST-313 (P1)** `client.p12` + passphrase ile certificate IPC kaydı → list'te
  görünür + passphrase şifreli saklanır; yanlış passphrase (`bad.p12` veya yanlış
  şifre) anlamlı hata. Önce `tests/main/cert-pipeline.test.ts`'in PFX'i ne kadar
  kapsadığını oku — unit'te varsa E2E yalnız IPC+UI katmanını test etsin.

### J — Büyük response performansı (P2) → `ux-misc.spec.ts`'e ek
- **MST-314 (P2)** Lokal test server'dan ~5 MB JSON → Send → response panel makul
  sürede render (cömert eşik, ör. 20 s) + UI responsive (tab tıklanabilir).
  workers=4'te flake yaparsa skip + not düşülecek.

## Kurallar (tüm implementasyonlar için)
1. Worker-paylaşımlı Electron: benzersiz adlar (`uid()`), scoped locator, viewport
   dışı menüler için `dispatchEvent('click')` — `docs/e2e/needs-hooks.md` ve
   bilinen paralel-stabilite pattern'leri geçerli.
2. src/ değişikliği yalnız `data-testid` ekleme düzeyinde (davranış değişikliği yok).
3. Agent'lar E2E/vitest KOŞMAZ (tek build + koşum merkezi yapılır); yalnız
   `npm run typecheck` serbest.
4. Dış ağ yok — yalnız lokal test server'ları (`tests/e2e/helpers/test-servers.ts`).
