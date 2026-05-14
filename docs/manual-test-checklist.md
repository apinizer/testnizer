# Testnizer — Manuel Test Checklist (v1.3.0 lokal build)

> Lokal DMG: `dist/ready-packages/Testnizer-1.3.0-arm64.dmg`
> Bu listeyi sırayla tıkla. Bir madde fail ederse "fail not"u sonuna ekle, sonra release'i durdurup ilgili modüle dönelim.
> Kısaltma: **R-x.y** numaraları "Recent fix" — son commit'lerde değiştiğini doğruladığımız davranış.

---

## 0. Kurulum + İlk Açılış

- [ ] DMG'yi mount et, Testnizer.app'i Applications'a sürükle
- [ ] İlk açılış — Gatekeeper "unidentified developer" uyarısı çıkarsa Privacy & Security → "Open Anyway"
- [ ] EULA ekranı tek seferde görünür, **EULA + Privacy** sekmeleri arasında geçebilirsin, "I agree" sonrası kapanır (consent gate)
- [ ] **R-1**: Eski "Apinizer" verisi varsa migrasyon gerekmez (canlıya çıkmadık) — fresh start gelir
- [ ] Dock'ta uygulama adı **"Testnizer"** olarak görünür (Electron değil)
- [ ] Pencere başlığı + macOS menü bar: "Testnizer"

---

## 1. Workspace + Project

- [ ] İlk açılışta default workspace + default project otomatik oluşur
- [ ] Sol üst Project Switcher → **+ New Project** → yeni proje oluşur
- [ ] Project rename → sidebar + tab'larda anında güncellenir
- [ ] Project Duplicate (varsa) — yeni proje aynı endpoint setiyle açılır
- [ ] Project Delete → onay + silinir
- [ ] **Branch dropdown** — proje başına en az `main` branch'i listelenir
- [ ] Branch oluştur, switch et, commit yap, history sekmesinde Save kaydı görünür

---

## 2. Settings → Project Detail Modal

- [ ] Sol alt **gear** ikonuna tıkla → ProjectDetailModal açılır
- [ ] Tab'lar: **Project / Environments / Variables / About** vb.
- [ ] **R-2 (About i18n fix)**: About sayfasında label'lar artık `about.subtitle / about.appName / about.platform` gibi i18n key string'i göstermiyor — düzgün İngilizce/Türkçe metinler:
  - Başlık: "About"
  - Alt başlık: "Application version, runtime and license info." / TR: "Uygulama sürümü, çalışma zamanı ve lisans bilgisi."
  - App adı: "Testnizer" (büyük başlık)
  - Tagline: "A free, cross-platform API testing workbench." / TR: "Ücretsiz, çapraz platform API test ortamı."
  - Grid satırları: VERSION / PLATFORM / ELECTRON / NODE / CHROME / LICENSE — hepsi insan-okunabilir
- [ ] ESC ile modal kapanır (Radix Dialog)

---

## 3. Sidebar Page Navigation (Bug 6 + Bug 7 fix)

- [ ] **APIs** sekmesi → solda Endpoint tree
- [ ] **Tests** sekmesi → solda Test Suite tree
- [ ] **Mocks** sekmesi → solda Mock Server listesi
- [ ] **History** sekmesi → solda son istek geçmişi
- [ ] **Tools** sekmesi → solda Tools kategori listesi
- [ ] **R-6 (page-scoped tab strip)**: APIs'da bir endpoint aç → Tests'e geç → tab strip Tests'e ait tab'ları gösterir, endpoint tab'ı görünmez. Geri APIs'a dön → endpoint tab geri gelir.
- [ ] **R-7 (page-aware welcome)**: Hiç tab açık değilken her sayfa kendi welcome ekranını gösterir:
  - APIs → ProjectWelcome (recent endpoints vb.)
  - Tests → TestsHome (suites + recent runs)
  - Mocks/History/Tools/Docs → EmptyState
- [ ] **R-3 (suite item tab routing)**: Test Suite içindeki bir request'e tıkla → tab açılır VE Tests sayfasında görünür. (APIs'a sızmaz.)
- [ ] **R-4 (mock tab routing)**: Mock Server item'a tıkla → tab Mocks sayfasında görünür.

---

## 4. Endpoint Editor (APIs)

- [ ] Header: **New Endpoint** → yeni tab açılır
- [ ] URL bar: method picker (GET/POST/PUT/...), URL input, Send/Cancel butonu, Save butonu
- [ ] **R-5 (cancel in-flight)**: Uzun süren bir GET başlat (örn. `https://httpbin.org/delay/10`) → Send → Cancel butonu aktif → bas → istek iptal edilir, "cancelled" mesajı
- [ ] Tabs: **Params / Headers / Authorization / Body / Scripts / Tests / Settings**

### 4.1 Headers tab — autocomplete (R-8)

- [ ] Boş satıra key alanına yazmaya başla → **header adı önerileri** (Accept, Authorization, Content-Type, ...) görünür
- [ ] Bir önerip seç → key dolar
- [ ] Value cell'e tıkla → focus üzerine **boş value'da bile** öneri açılır:
  - `Content-Type` → application/json, application/xml, multipart/form-data, vd.
  - `Accept` → application/json, */*, vd.
  - `Cache-Control` → no-cache, max-age=*, ...
  - `Connection` → keep-alive, close, ...
  - `Authorization` → Bearer , Basic , Digest 
- [ ] Value'da "json" yazınca filtrelenir; öneri panel doğru pozisyonda (cell altında, 0,0'a kaçmadan)
- [ ] **R-9**: Variable autocomplete (`{{` yazınca env vars listelenir) — value cell'inde de çalışıyor

### 4.2 Body tab

- [ ] None / Form-data / x-www-form-urlencoded / Raw (JSON/XML/HTML/JS/Text) / Binary / GraphQL
- [ ] Form-data: text + **file** row tipi seçilebilir → file picker açılır → seçtikten sonra dosya adı + clear (×) görünür
- [ ] Raw JSON: Monaco syntax highlight, otomatik format

### 4.3 Auth tab

- [ ] Inherit / None / Basic / Bearer / API Key / Digest / OAuth 1/2 / Hawk / NTLM / AWS / WSSE
- [ ] Basic → username + password (eye toggle ile gizle/göster)
- [ ] Bearer token → input

### 4.4 Pre-request + Post-response Scripts (R-10 Script Help)

- [ ] **Scripts** tab'a tıkla
- [ ] Pre-request / Post-response sub-tab geçişi
- [ ] **R-10 Help butonu** (HelpCircle ikonu, sağ üst köşede): tıkla → "Script Reference" modal açılır
  - [ ] Variant doğru (Post-response için Response checks başlıyor, Pre-request için Pre-request basics)
  - [ ] Snippet kartları: status check, JSON body, header, response time, env set/get
  - [ ] API referans tablosu (~15 satır): `pm.response.*`, `pm.environment.*`, `pm.test`, `pm.expect` vb.
  - [ ] Notlar bölümü: pm/t alias, async, scope, console
  - [ ] ESC veya × ile modal kapanır
- [ ] "+ Insert example" butonu → editor placeholder ile dolar (`pm.test(...)`)
- [ ] Yazdığın script gerçekten store'a yazılır (Monaco görünür ≠ store dolu eski bug'ı yok)

### 4.5 Tests tab (Visual Assertions)

- [ ] **+ Add Assertion** → kategoriler (Status / Body / Headers / Performance) → "Status code equals" gibi seç
- [ ] Assertion row düzenle (expected value)
- [ ] Post-response Script bölümünde Help butonu (variant=post)

### 4.6 Save (R-11 Cmd+S fix)

- [ ] Endpoint düzenle → tab adında dirty noktası (•) görünür
- [ ] `Cmd+S` veya Save butonu → kaydedilir, dirty noktası kaybolur
- [ ] **Suite item için**: tab `testSuiteItemId` taşır, save aynı yöntemle çalışır (UrlBar suite-aware)
- [ ] Save sonrası başarı toast'ı

### 4.7 Send + Response

- [ ] Send → response paneline geç
- [ ] Response panel: status code (renkli) + duration + size badge'leri
- [ ] **R-12 (Response sıralaması)**: Tabs — Body | Cookies | Headers | Test Results | Console | Actual | (WS-Security SOAP'ta)
- [ ] **Body** tab: Pretty / Raw / Preview seçici, Monaco syntax highlight
- [ ] **Headers** tab: read-only key/value tablo
- [ ] **Test Results** tab:
  - [ ] Visual assertion'lar görünür (PASSED/FAILED badge)
  - [ ] **R-13**: `pm.test()` script sonuçları da görünür (visual + script merge)
  - [ ] Sayaç (tab başlığında "Test Results 2/2") doğru
- [ ] **Console** tab: pre/post script `console.log` çıktıları (her zaman aktif, 1000 entry virtualized)
- [ ] **Actual** tab: gönderilen gerçek request (header'lar resolved, body resolved vars)

---

## 5. Test Suite (Tests sekmesi)

- [ ] Tests sekmesi → "+ Create Test Suite" → suite oluşur
- [ ] Suite içine "+ New Request" → yeni item açılır, request_schema kaydedilir
- [ ] **R-3 spot test**: yeni item'a tıkla → editör formu görünür (TAM olarak APIs'taki gibi)
- [ ] Item rename → suite tree'de güncellenir
- [ ] Suite item Send + Test Results pipeline doğru (suite item tab'ında pm.test çalışıyor — R-14 doğrulama)
- [ ] Sağ tık → context menu (Run / Rename / Duplicate / Delete)
- [ ] Suite Run → RunnerResults panel açılır:
  - [ ] Sol panel: iteration listesi, All/Passed/Failed/Skipped tab'ları
  - [ ] Sağ panel: seçili iteration detayı
  - [ ] **R-15 (RunnerResults sıralaması)**:
    - Request tab: **Method/URL özet üstte → Headers tablo → Body Monaco altta**
    - Response tab: **Response Headers tablo üstte → Tests assertions → Body Monaco altta**
    - Her iki tab'da Body bar'ında "Pretty ∨" göstergesi
- [ ] **R-16 Import (modal'lı)**: Tests panel'in üst Upload butonu → **modal** açılır (artık doğrudan file picker DEĞİL):
  - [ ] Üç format kartı: Testnizer Test Suite / Postman Collection / Insomnia Collection
  - [ ] Bir kart "Dosya Seç" tıkla → file picker
  - [ ] Postman v2.1 collection import et → suite oluşur, item'lar yüklenir
  - [ ] Insomnia v5 YAML import et → suite oluşur
  - [ ] (Test fixture'larından örnekle: `tests/fixtures/external-imports/postman/oracle-crud.postman_collection.json` veya `insomnia/oracle-crud-test.yaml`)
  - [ ] Hata mesajları toast olarak görünür

---

## 6. Runner (Run Sequence)

- [ ] Tests → "New Run" / "Run Again" butonu
- [ ] Run sırasında progress bar + "Running N of M"
- [ ] Stop butonu → çalışan run iptal edilir
- [ ] Bittiğinde stats: Source / Environment / Iterations / Duration / All tests / Errors / Avg. Resp. Time
- [ ] Iteration listesi, expand/collapse
- [ ] **R-13 doğrulama**: pm.test'ler ve visual assertion'lar **birlikte** raporlanır
- [ ] "View all runs" tıkla → geçmiş run'lar
- [ ] Schedule (Scheduler tab'ı varsa): yeni scheduled run oluştur

---

## 7. Environments (proje-scoped)

- [ ] Sağ üst environment dropdown → aktif env seç
- [ ] **+ New Environment** → ad ver, oluşur
- [ ] Variables tablo: Initial Value + Current Value + Type (secret toggle = göz ikonu)
- [ ] Variable'ı request'te `{{baseUrl}}` ile kullan, Send → resolved actual request'te genişlemiş
- [ ] **Globals** sekmesi — workspace-wide
- [ ] **R-17 Import butonu (Environment Modal)**:
  - [ ] Sol alt **Import** butonu → file picker
  - [ ] Postman environment file (`{ _postman_variable_scope: 'environment', values: [...] }`) seç → otomatik tanır, env eklenir
  - [ ] Insomnia v4/v5 file → env resource'larını çeker
  - [ ] Postman collection seçersen → "This looks like a collection, use APIs → Import" hata toast'ı
  - [ ] Tanınmayan dosya → "Unrecognised file" hata toast'ı

---

## 8. History panel

- [ ] Her Send sonrası history'e bir satır eklenir (URL, method, status, duration)
- [ ] Satıra tıkla → o request tekrar açılır
- [ ] Recent runs (Runner) ayrı listede

---

## 9. Tools panel (browser-safe utilities)

Sol panel kategorileri:
- [ ] **JWT** decode/encode (HS256, RS256)
- [ ] **JSONPath** evaluator
- [ ] **XPath** evaluator
- [ ] **Hash** (MD5, SHA-1, SHA-256, SHA-512)
- [ ] **HMAC** (HMAC-SHA256 vb.)
- [ ] **Diff** (text/JSON)
- [ ] **Encoders** (Base64, URL, HTML, Hex)
- [ ] **Regex** test
- [ ] **Epoch** time converter
- [ ] **UUID** generator
- [ ] **Base** converter (binary/octal/decimal/hex)
- [ ] **JSON ↔ XML** converter
- [ ] **JSON ↔ YAML** converter
- [ ] **JSON Schema** validator
- [ ] **Jolt** transformer
- [ ] **WS-Security** generator (UsernameToken, Timestamp, Signature)
- [ ] **XSLT** transformer (samples-smoke tested)

---

## 10. Mock Servers

- [ ] Mocks sekmesi → "+ New Mock Server" → ad + port (default 4000)
- [ ] Mock Server Editor:
  - [ ] **Endpoints** tab → "+ Add Endpoint" → method + path
  - [ ] **Responses** her endpoint için: status code, headers (JSON), body, delay
  - [ ] **CORS** tab → enabled, origins, methods, credentials, max-age
  - [ ] **Auth** tab → none/basic/bearer/api-key
  - [ ] **Failure** tab → enabled, probability, mode (status/timeout)
  - [ ] **Rate limit** tab → enabled, requests/window, scope (ip/path/global)
  - [ ] **Proxy** tab → enabled, target, record
- [ ] Start mock server → port'a istek at (`curl http://127.0.0.1:4000/...`) → response gelir
- [ ] Stop server → istekler reddedilir
- [ ] **Echo mode** açıkken → request → aynısını response olarak döner

---

## 11. Import / Export — APIs tarafı

### Import (APIs → Header → Import)

- [ ] **OpenAPI/Swagger** (`.json` / `.yaml`)
- [ ] **Postman v2.1** (`tests/fixtures/external-imports/postman/oracle-crud.postman_collection.json`)
  - [ ] 6 endpoint, header + body + scripts + collection variable korunur
- [ ] **Insomnia v4** (legacy JSON)
- [ ] **Insomnia v5 YAML** (`tests/fixtures/external-imports/insomnia/oracle-crud-test.yaml`)
- [ ] **R-18**: Insomnia `spec.insomnia.rest/5.0` (`dynamic-ttl-test-proxyspec.yaml`) artık reddedilmez, import edilir
- [ ] **cURL** komut yapıştır → endpoint
- [ ] **WSDL** URL ya da file → SOAP endpoint'leri oluşur
- [ ] **SoapUI project** XML (`tests/fixtures/external-imports/soapui/student-soapui-project.xml`)
- [ ] **RAML** (`.raml`)
- [ ] **proto** dosyası → gRPC endpoint'leri

### Export

- [ ] APIs → Header → **Export Project** → JSON dosyası indirir
- [ ] **R-19**: Bu JSON'ı **Import Project** ile aynı/farklı projeye geri yükle → env+global `project_id` doğru korunur (eskiden silinti vardı, fix uygulandı)
- [ ] **Export Folder** → folder tree JSON
- [ ] **Export → Postman** → Postman v2.1 collection üretir
- [ ] **Export → Insomnia** → Insomnia v4 JSON
- [ ] **Export → OpenAPI** → OpenAPI 3 YAML
- [ ] **Export → cURL** (per request) → cURL string clipboard

---

## 12. Protokol Smoke Testleri

### HTTP REST

- [ ] GET `https://httpbin.org/get` → 200 + JSON body
- [ ] POST `https://httpbin.org/post` + raw JSON body → 200, body echo
- [ ] Redirect `https://httpbin.org/redirect/3` → follow
- [ ] Timeout: invalid host → timeout error
- [ ] mTLS scenarios (aşağıdaki §13)

### SOAP

- [ ] WSDL parse: `http://www.dneonline.com/calculator.asmx?WSDL` → operations listesi
- [ ] Add operation → SOAP envelope auto-fill → Send → 200 envelope yanıt
- [ ] WSSE tab: UsernameToken oluştur, Send

### WebSocket

- [ ] `wss://echo.websocket.org/` connect → connected status
- [ ] Mesaj gönder → echo gelir (bidi timeline)
- [ ] Disconnect

### Server-Sent Events (SSE)

- [ ] Test endpoint → connect → eventler timeline'a düşer
- [ ] Disconnect

### GraphQL

- [ ] `https://countries.trevorblades.com/` (public GraphQL)
- [ ] Query: `{ countries { code name } }` → 200 + data
- [ ] Schema introspection (varsa)

### gRPC

- [ ] **Server reflection**: `demo.connectrpc.com:443` veya benzeri
- [ ] Unary call: ElizaService.Say → response

### Socket.IO

- [ ] Echo server (`scripts/socketio-echo-server.cjs` lokalde) → connect → emit/subscribe

### MCP (Model Context Protocol)

- [ ] Streamable HTTP/SSE/stdio transport seçici
- [ ] Connect → tools/list response
- [ ] callTool → response

### AI Chat (varsa konfigüre)

- [ ] Provider config (API key)
- [ ] Mesaj gönder → stream response
- [ ] Tools bridge (Tools panel'i çağırabiliyor)

---

## 13. Certificates / mTLS (BadSSL spot test)

- [ ] Project Detail → Certificates tab → "+ Add Certificate"
- [ ] CA cert ekle (file picker) → enabled
- [ ] Client cert (PEM): crt + key + (opsiyonel) passphrase
- [ ] Client cert (PFX/PKCS12): pfx + passphrase
- [ ] Host filter: exact / wildcard `*`
- [ ] Test request — `https://expired.badssl.com/`:
  - [ ] Default Send → fail (cert expired error)
  - [ ] Settings → SSL verification: false → Send → 200
- [ ] `https://self-signed.badssl.com/` aynı pattern
- [ ] `https://wrong.host.badssl.com/` → hostname mismatch error
- [ ] **Cipher preset** (Settings → TLS): legacy seç → `https://tls-v1-0.badssl.com:1010/` minVersion=TLSv1 ile dene

---

## 14. Modaller + UX

- [ ] Her modal **ESC** ile kapanır (Radix Dialog migration)
- [ ] Modal dışına tıklama → kapanır (Eula Modal hariç — preventClose)
- [ ] **Cmd+K** → Command Palette açılır
  - [ ] Endpoint adıyla arama
  - [ ] Recent / Tools / Mock Server / Settings kategorileri
- [ ] **Cmd+S** → mevcut tab kaydedilir
- [ ] Toast'lar (sonner): başarı/hata mesajları
- [ ] Empty states her ana panelde mantıklı görünür

---

## 15. Persistence / Restart

- [ ] Uygulamayı kapat, tekrar aç:
  - [ ] Açık tab'lar restore edilir
  - [ ] Active project + branch + environment hatırlanır
  - [ ] Recent history sidebar'da görünür
  - [ ] Console log buffer reset olur (per-session)
- [ ] `~/Library/Application Support/Testnizer/` altında SQLite DB + settings dosyası mevcut

---

## 16. Recent Bug Fix Spot Check (kritik regression önleme)

- [ ] **R-3** Suite item'a tıkla → edit formu açılır
- [ ] **R-6** Import sonrası APIs sekmesinde kal — otomatik Tests'e geçmez
- [ ] **R-7** Tab boşken sayfa-aware welcome (Run Sequence "kalıntı" tab'ı sızmaz)
- [ ] **R-8** Headers value autocomplete (Content-Type, Accept, vb. focus'ta boş value ile)
- [ ] **R-10** Script Help modal — Pre/Post variant doğru
- [ ] **R-12** Response panel sırası: Headers üstte, Body altta
- [ ] **R-15** RunnerResults: Request tab'da Method/URL özet üstte
- [ ] **R-16** Tests panel Import — direkt file picker değil, format kartlı modal
- [ ] **R-17** EnvironmentModal'da Import butonu var
- [ ] **R-18** Insomnia spec.insomnia.rest dosyası import edilir
- [ ] **R-19** Project export → import → env+global project_id korunur
- [ ] **R-20** YAML test suite import: Insomnia v5 YAML suite olarak import edilebiliyor
- [ ] **R-21** Test Suite item self-contained (copy-on-add) — source endpoint silinse bile item çalışmaya devam eder

---

## 17. Performans / Bellek (informal)

- [ ] Büyük JSON response (10 MB) → Monaco hala akıcı
- [ ] 1000 console entry virtualized (donmama)
- [ ] Çoklu sekme açıkken hafıza ~500 MB altı (Activity Monitor)
- [ ] Idle CPU < %5

---

## 18. Sonuç

- [ ] Toplam fail not'u sıfır
- [ ] Aksi takdirde: `release blocker` etiketi ile fail listesi yaz, release'i ertele

**Tarih**: ______________
**Tester**: ______________
**Build**: `Testnizer-1.3.0-arm64.dmg` SHA256: `1f7af716b4f7a5705bd6fb6cf710656899349f2b757bab39265e72e9c94818cc`

Yeniden hesaplamak için: `shasum -a 256 dist/ready-packages/Testnizer-1.3.0-arm64.dmg`
