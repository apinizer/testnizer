---
title: Tüm özellikler
description: Testnizer'ın yaptığı her şeyin eksiksiz referansı — protokoller, kimlik doğrulama, değişkenler, test, runner, mock, içe/dışa aktarma, kod üretimi ve yerleşik araçlar.
order: 3
section: Başlarken
---

Testnizer'ın tüm yetenek yüzeyi, alanlara göre gruplanmış. Aşağıdaki her şey
**%100 yerel** çalışır — hesap yok, bulut yok, telemetri yok. Daha ayrıntılı
sayfalar için her bölümdeki bağlantıları izleyin.

## Protokoller

Her protokol; kendi editörü, yanıt paneli ve Node tarafı motoru olan
birinci sınıf bir istek türüdür — eklenti değil. Bkz. [Protokoller](/tr/docs/protocols).

| Protokol | Öne çıkanlar |
|---|---|
| HTTP / REST | Method'lar, body modları, yönlendirme, timeout, mTLS, script, assertion |
| SOAP / WSDL | WSDL içe aktarma, manuel envelope, operation seçimi |
| WS-Security | UsernameToken, Timestamp, RSA-SHA256 imzalama, şifreleme — bkz. [WS-Security](/tr/docs/ws-security) |
| GraphQL | Query, mutation, subscription, schema introspection |
| gRPC | Proto yükleme + **server reflection**, dört streaming modu |
| WebSocket | `wss`, parametreler + özel header, Metin / JSON / XML / HTML / binary composer, kayıtlı mesajlar, hexdump, çift yönlü timeline |
| Socket.IO | İstemci v4 / v3 / v2, namespace, dinleyiciler, Ack, çok argümanlı emit, kayıtlı mesajlar, event timeline |
| MQTT | 3.1.1 ve 5.0, `mqtt(s)://` ve `ws(s)://`, konular, QoS, retain, Last Will, kayıtlı mesajlar |
| SSE | Uzun ömürlü akışlar, adlı event'ler, `Last-Event-ID` resume — bkz. [SSE](/tr/docs/protocols/sse) |
| MCP | Streamable HTTP / SSE / stdio; araçlar, kaynaklar, istemler, bildirimler, OAuth 2.1, güvenlik taraması |
| AI Chat | Çoklu LLM provider + özel URL, streaming, çağrı başına onaylı MCP sunucuları araç olarak, yerel konuşmalar — bkz. [AI Chat](/tr/docs/protocols/ai-chat) |

## İstek oluşturma

- Canlı **query-param ↔ URL** senkronizasyonu olan method + URL bar
- Toplu düzenlemeli **header**'lar
- **Body** modları: raw / JSON / XML / HTML / text, **form-data** (dosya yükleme),
  **x-www-form-urlencoded**, **binary**
- Bir **cURL** komutunu URL çubuğuna yapıştırın, istek olsun
- **Path değişkenleri** (URL yolundaki `:id`) kendi tablosunda
- **Headers** sekmesi otomatik header'ları (Accept, User-Agent, Host,
  Content-Type, Content-Length, auth, cookie) ve her birinin kaynağını listeler;
  eklediğiniz header otomatik olanı ezer
- İstek başına timeout, yönlendirme takibi (max redirects), SSL doğrulama anahtarı
  — istekle birlikte kaydedilir; dokunmadığınızda önce Proje Ayarlarından, sonra
  Uygulama Ayarlarından miras alınır
- Pre-request ve post-response **script** sekmeleri

## Kimlik doğrulama

Basic · Bearer Token · API Key (header veya query) · OAuth2 · Digest · NTLM ·
Hawk · AWS Signature.

## Değişkenler & ortamlar

Bkz. [Ortamlar & değişkenler](/tr/docs/environments).

- Proje-scope **ortamlar**, çift **Initial / Current Value** modeliyle
- Proje başına **Globaller** — Postman globals ve collection variables tek listede; bir ortam için **Globallere taşı**
- Zincirli referanslı `{{değişken}}` substitution
- **Dinamik değerler**: `{{$randomInt}}`, `{{$guid}}`, `{{$timestamp}}` ve daha fazlası
- Satır içi değişken autocomplete

## Test & assertion

Kod yazmadan assertion: status eşittir, status aralıkta, body içerir, header
var / eşittir / içerir, yanıt süresi altında, yanıt boyutu altında. Assertion
değerleri de `{{değişken}}` çözer. Bkz. [Script & test assertion](/tr/docs/scripts).

## Scripting

Postman / Insomnia uyumlu `pm.*` API; Send'de ve Runner'da aynısı:

- `pm.environment` / `pm.globals` / `pm.variables` / `pm.collectionVariables` get & set ve sır Globaller için `pm.vault`
- `pm.test()`, `pm.expect()` (chai-BDD chain), `pm.response`
- `pm.iterationData`, `pm.execution.skipRequest()` / `setNextRequest()`
- Postman'in 118 dinamik değişkeninin tamamı (`{{$randomEmail}}` …)
- Script'ler sandbox'lı değildir; Git'ten ya da proje dosyasından gelen bir proje,
  siz bu bilgisayarda izin verene kadar hiçbir script çalıştırmaz

## Koleksiyon çalıştırma

Bkz. [Collection runner & otomasyon](/tr/docs/cli-and-automation).

- Sıralı çoklu istek koşumu, **iterasyon** + **data-driven** satırlar (CSV / JSON)
- İstekler arası delay, hata-da-dur, ortam seçimi; sonuçlar koşumun kullandığı
  ortamı adıyla gösterir
- **Kritik istek** — hata-da-dur ne derse desin, başarısız olunca koşumu durduran istek
- Yalnızca koşum kırmızı bittiğinde çalışan bir **Çalıştırma hata betiği**
- Tek rapor üreticisinden **HTML & JSON** rapor, koşum geçmişi + istatistik
- Tekrarlı koşumlar için **Scheduler**
- MCP istekleri de koşar; geçti / kaldı kuralları Send ile aynıdır
- Herhangi bir klasör veya koleksiyona sağ tık **Run**
- **Test Suites** — çoklu koleksiyondan kurulu setler, her item tam istek snapshot'ı

## Mock sunucu

**Mocks** panelinde, `127.0.0.1` üzerinde çalışan dört türde gerçek sunucu. Bkz.
[Mock sunucular](/tr/docs/mock-server).

- **[HTTP](/tr/docs/mock-server/http)** — `{{değişken}}` template'i, koşullu
  kurallar, scriptli yanıtlar, kimlik doğrulama, rate limit, hata enjeksiyonu ve
  şema doğrulamalı kural-bazlı uç noktalar; OpenAPI / Swagger / Postman
  dosyasından ya da kayıtlı isteklerden oluşan bir klasörden kurulabilir
- **[SSE](/tr/docs/mock-server/sse)** — tanımladığınız event'leri akıtır; aralık,
  heartbeat, döngü ve `Last-Event-ID` resume destekler
- **[AI (LLM)](/tr/docs/mock-server/ai)** — OpenAI chat ve Anthropic messages
  API'lerini yanıtlar; streaming ve kasıtlı akış ortası hatalar sunar
- **[MCP](/tr/docs/mock-server/mcp)** — araçlar, kaynaklar, istemler, bearer
  kimlik doğrulama ve hata senaryoları olan yerel bir MCP sunucusu

## İçe & dışa aktarma

Bkz. [İçe & dışa aktarma](/tr/docs/import-formats).

- İçe aktarma: **OpenAPI / Swagger**, **Postman** (v1 – v3, klasörler, `.zip`),
  **Insomnia**, **HAR**, **cURL** (bash, CMD, PowerShell — ya da URL çubuğuna
  yapıştırarak), **WSDL**, **RAML**, **SoapUI**, **Testnizer Native** — otomatik
  format tespitiyle
- Dışa aktarma: tüm proje veya klasör alt ağacı — Testnizer JSON, Postman
  v2.1 / v3, OpenAPI 3, Insomnia

## Kod üretimi

20 dil ve 36 varyantta kopyala-yapıştır hazır istek snippet'i üretin —
**cURL** (bash, CMD, PowerShell), **JavaScript** (Fetch / XHR / jQuery),
**NodeJS**, **Python**, **Java**, **C#**, **Go**, **PHP**, **Ruby**, **Kotlin**,
**Swift**, **Rust**, **Dart**, **R**, **C**, **Objective-C**, **OCaml**,
**PowerShell**, **Shell** (wget / HTTPie) ve ham **HTTP** — varyant başına
seçeneklerle. Bkz. [Kod snippet oluşturma](/tr/docs/protocols/http#kod-snippet-oluşturma).

## Yerleşik araçlar

Offline, tarayıcı-güvenli yardımcılar — bkz. [Yerleşik araçlar](/tr/docs/built-in-tools)
ve [JWT Debugger](/tr/docs/jwt-debugger):

JWT · JSONPath · XPath · XSLT · Hash · HMAC · Encoder'lar (Base64 / URL) ·
Base dönüştürücü · Regex test · Diff · Epoch / timestamp · UUID üretici ·
JSON ↔ XML · YAML ↔ JSON · Jolt transform · JSON Schema · JSON / XML formatlayıcı ·
HTTP status referansı · WS-Security yardımcısı.

## Güvenlik araçları

**Security** sayfası anahtar, PKI, token ve kimlik takımını bir arada toplar:
[Keystore Studio](/tr/docs/keystore-studio) (JKS / PKCS#12),
[JWK / JWKS](/tr/docs/jwk-jwks), [JWT / JOSE debugger](/tr/docs/jwt-debugger)
(imzalama, doğrulama, JWE), [TLS Inspector](/tr/docs/tls-inspector),
[SAML](/tr/docs/saml) oluşturma / imzalama / doğrulama; ayrıca bir OTP
Authenticator (TOTP / HOTP), bir Parola Üretici ve bir QR aracı. Tamamı offline
çalışır — tasarımı gereği işaret ettiğiniz endpoint'e bağlanan TLS Inspector
hariç.

## Organizasyon & versiyon kontrol

- **Workspace → Proje → Branch** hiyerarşisi
- **Git entegrasyonu** (proje başına branch, seçmeli commit'li Commit paneli, Pull / Push / Merge, conflict yönetimi) — bkz. [Git entegrasyonu](/tr/docs/git-branches)
- Sürükle-bırak sıralamalı endpoint / klasör ağacı
- Eşleşen bir klasörün **tüm alt ağacını** koruyan ağaç **araması** — kök
  düzeydeki istekler dahil (Postman / Insomnia davranışı)
- Bir klasöre sağ tıklayın → tüm alt ağaç için **Expand All / Collapse All** —
  arama filtresi aktifken bile

## İstek geçmişi

Tam istek/yanıt snapshot'ları, "Today" gruplaması ve detay paneli olan yerel
istek geçmişi. Kimlik bilgileri ve secret değerleriniz bir satır saklanmadan önce
maskelenir. Bkz. [İstek geçmişi](/tr/docs/history).

## Yanıt görüntüleme

- Status / timing / boyut meta verisi, Monaco JSON syntax highlight
- Response · Cookies · Headers · Console · **Actual Request** sekmeleri
- Timing dökümü (DNS / TCP / TLS / TTFB / indirme)

## Sertifikalar & TLS

mTLS / client sertifikaları, TLS preset'leri, eski sunucular için **Legacy TLS**
yönlendirmesi, özel truststore ve şifrelenmiş passphrase saklama. Bkz.
[Sertifikalar](/tr/docs/certificates).

## Güvenlik & gizlilik

- Opsiyonel **uygulama şifresi** (açılışta bir kilit; veritabanı şifrelemesi değil)
- Secret değişkenler, mock token'ları ve sertifika passphrase'leri yerel
  veritabanında işletim sisteminin anahtarlığıyla şifrelenir; uygulamadan çıkan
  her dosyaya (Git, dışa aktarmalar) boş yazılır
- Geçmiş, Console, koşum raporları ve mock logları kimlik bilgilerini maskeler
- İlk açılışta EULA / gizlilik onayı
- `contextIsolation` açık, `nodeIntegration` kapalı, sandbox'lı renderer, web
  izinleri varsayılan olarak reddedilir, sıkı CSP — arayüz ağa asla doğrudan
  dokunmaz; tüm trafik Node main process'inden geçer

Bkz. [Neden offline?](/tr/docs/why-offline).

## Platform

- **Windows, macOS 13 (Ventura) veya üstü, Linux** (x64 + arm64)
- **Standalone & %100 offline** — sıfır harici bağımlılık
- Yerel **SQLite** depolama; her güncellemeden önce veritabanı yedeği alınır — bkz. [Başlarken](/tr/docs/getting-started#güncellemeden-sonra-bir-yedeği-geri-yükleme)
- Yerleşik **otomatik güncelleme**
- Native aç / kaydet / mesaj dialog'ları
