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
| WebSocket | `wss`, özel header, JSON composer, çift yönlü timeline |
| Socket.IO | Namespace, `auth.token`, emit + subscribe, event timeline |
| SSE | Uzun ömürlü akışlar, adlı event'ler, `Last-Event-ID` resume |
| MCP | Streamable HTTP / SSE / stdio; tool listele + çağır |
| AI Chat | Çoklu LLM provider + özel URL, streaming, tools köprüsü |

## İstek oluşturma

- Canlı **query-param ↔ URL** senkronizasyonu olan method + URL bar
- Toplu düzenlemeli **header**'lar
- **Body** modları: raw / JSON / XML / HTML / text, **form-data** (dosya yükleme),
  **x-www-form-urlencoded**, **binary**
- İstek başına timeout, yönlendirme takibi (max redirects), SSL doğrulama anahtarı
- Pre-request ve post-response **script** sekmeleri

## Kimlik doğrulama

Basic · Bearer Token · API Key (header veya query) · OAuth2 · Digest · NTLM ·
Hawk · AWS Signature.

## Değişkenler & ortamlar

Bkz. [Ortamlar & değişkenler](/tr/docs/environments).

- Proje-scope **ortamlar**, çift **Initial / Current Value** modeliyle
- Workspace ve proje scope'unda **global değişkenler**
- Zincirli referanslı `{{değişken}}` substitution
- **Dinamik değerler**: `{{$randomInt}}`, `{{$guid}}`, `{{$timestamp}}` ve daha fazlası
- Satır içi değişken autocomplete

## Test & assertion

Kod yazmadan assertion: status eşittir, status aralıkta, body içerir, header
var / eşittir / içerir, yanıt süresi altında, yanıt boyutu altında. Assertion
değerleri de `{{değişken}}` çözer. Bkz. [Script & test assertion](/tr/docs/scripts).

## Scripting

Sandbox'lı runtime'da Postman / Insomnia uyumlu `pm.*` API:

- `pm.environment` / `pm.globals` / `pm.variables` / `pm.collectionVariables` get & set
- `pm.test()`, `pm.expect()` (chai-BDD chain), `pm.response`
- `pm.iterationData`, `pm.execution.skipRequest()` / `setNextRequest()`

## Koleksiyon çalıştırma

Bkz. [Collection runner & otomasyon](/tr/docs/cli-and-automation).

- Sıralı çoklu istek koşumu, **iterasyon** + **data-driven** satırlar (CSV / JSON)
- İstekler arası delay, hata-da-dur, ortam seçimi
- **HTML & JSON** rapor, koşum geçmişi + istatistik
- Tekrarlı koşumlar için **Scheduler**
- Herhangi bir klasör veya koleksiyona sağ tık **Run**
- **Test Suites** — çoklu koleksiyondan kurulu setler, her item tam istek snapshot'ı

## Mock sunucu

`{{değişken}}` template'i, koşullu kurallar, scriptli yanıtlar, kimlik doğrulama,
rate limit, hata enjeksiyonu ve şema doğrulamalı yerel kural-bazlı HTTP mock
sunucusu. Bkz. [Mock Server](/tr/docs/mock-server).

## İçe & dışa aktarma

Bkz. [İçe & dışa aktarma](/tr/docs/import-formats).

- İçe aktarma: **OpenAPI / Swagger**, **Postman**, **Insomnia**, **HAR**, **cURL**,
  **WSDL**, **RAML**, **SoapUI**, **Testnizer Native** — otomatik format tespitiyle
- Dışa aktarma: tüm proje veya klasör alt ağacı, kayıpsız round-trip

## Kod üretimi

**cURL**, **JavaScript** (fetch / axios), **Python** (requests), **Java**
(OkHttp), **C#**, **Go**, **PHP**, **Ruby**, **Kotlin** ve **Swift** için
kopyala-yapıştır hazır istek snippet'i üretin.

## Yerleşik araçlar

Offline, tarayıcı-güvenli yardımcılar — bkz. [Yerleşik araçlar](/tr/docs/built-in-tools)
ve [JWT Debugger](/tr/docs/jwt-debugger):

JWT · JSONPath · XPath · XSLT · Hash · HMAC · Encoder'lar (Base64 / URL) ·
Base dönüştürücü · Regex test · Diff · Epoch / timestamp · UUID üretici ·
JSON ↔ XML · YAML ↔ JSON · Jolt transform · JSON Schema · JSON / XML formatlayıcı ·
HTTP status referansı · WS-Security yardımcısı.

## Organizasyon & versiyon kontrol

- **Workspace → Proje → Branch** hiyerarşisi
- **Git entegrasyonu** (proje başına branch, conflict yönetimi) — bkz. [Git entegrasyonu](/tr/docs/git-branches)
- Sürükle-bırak sıralamalı endpoint / klasör ağacı

## İstek geçmişi

Tam istek/yanıt snapshot'ları, "Today" gruplaması ve detay paneli olan yerel
istek geçmişi. Bkz. [İstek geçmişi](/tr/docs/history).

## Yanıt görüntüleme

- Status / timing / boyut meta verisi, Monaco JSON syntax highlight
- Response · Cookies · Headers · Console · **Actual Request** sekmeleri
- Timing dökümü (DNS / TCP / TLS / TTFB / indirme)

## Sertifikalar & TLS

mTLS / client sertifikaları, TLS preset'leri, eski sunucular için **Legacy TLS**
yönlendirmesi, özel truststore ve şifrelenmiş passphrase saklama. Bkz.
[Sertifikalar](/tr/docs/certificates).

## Güvenlik & gizlilik

- Yerel veri için opsiyonel **şifre** koruması
- İlk açılışta EULA / gizlilik onayı
- `contextIsolation` açık, `nodeIntegration` kapalı, sıkı CSP — arayüz ağa asla
  doğrudan dokunmaz; tüm trafik Node main process'inden geçer
- Geçmişte URL credential temizleme. Bkz. [Neden offline?](/tr/docs/why-offline).

## Platform

- **Windows, macOS, Linux** (x64 + arm64)
- **Standalone & %100 offline** — sıfır harici bağımlılık
- Yerel **SQLite** depolama, şifrelenmiş config
- Yerleşik **otomatik güncelleme**
- Native aç / kaydet / mesaj dialog'ları
