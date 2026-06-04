---
title: Protokollere genel bakış
description: Testnizer'da HTTP, SOAP, WebSocket, GraphQL, gRPC, SSE, Socket.IO, MCP ve AI Chat için hızlı referans.
order: 1
section: Protokoller
---

Testnizer her protokolü birinci sınıf bir istek türü olarak ele alır — bir eklenti veya
ek modül olarak değil. Her birinin kendine ait bir editörü, kendine ait bir yanıt paneli ve
Node ana sürecinde kendine ait bir motoru vardır.

## Kısa bakış

| Protokol | Editör | Motor | Notlar |
|---|---|---|---|
| HTTP / REST | tam | `axios` | Metodlar, gövde modları, mTLS, scriptler, assertion'lar |
| SOAP | tam | `soap` kütüphanesi + `wsse` | WSDL import, manuel envelope, WS-Security |
| WebSocket | tam | `ws` | wss + özel header'lar + JSON composer |
| GraphQL | tam | `graphql` + `graphql-ws` | Sorgu + mutasyon + abonelik |
| gRPC | tam | `@grpc/grpc-js` + `@grpc/proto-loader` | Dört streaming modu |
| SSE | tam | `eventsource` | Uzun süreli akışlar, Last-Event-ID ile devam |
| Socket.IO | tam | `socket.io-client` | Namespace'ler, auth, emit + subscribe, çift yönlü zaman çizelgesi |
| MCP | tam | `@modelcontextprotocol/sdk` | Streamable HTTP / SSE / stdio; araçları listele ve çağır |
| AI Chat | tam | sağlayıcıya özgü HTTP | 14 sağlayıcı + özel URL, streaming |

## HTTP

Varsayılan. Bir metod seçin, URL'yi girin, isteğe bağlı olarak header / body / auth ekleyin.
Gönder'e tıklayın.

Gövde modları:

- **none** — gövde yok
- **raw** — content-type seçici ile metin (JSON, XML, plain, özel)
- **form-data** — `multipart/form-data`, metin ve dosya alanlarını destekler
- **x-www-form-urlencoded** — URL-encoded anahtar/değer çiftleri
- **binary** — tüm gövde olarak dosya yükleme, content-type uzantıdan belirlenir

Auth modları: Basic, Bearer, API Key (header / query / cookie), Digest, NTLM,
Hawk, AWS Signature v4, OAuth 1.0, OAuth 2.0 (tam akış), Üst koleksiyondan auth devral.

[Tam referans →](/tr/docs/protocols/http)

## SOAP

İki başlangıç noktası:

- **WSDL'den** — bir URL yapıştırın veya dosya seçin. Testnizer servisleri,
  portları ve operasyonları ayrıştırır, ardından her operasyon için bir örnek envelope oluşturur
- **Manuel** — envelope'u elle yazın. Hata ayıklama veya WSDL'si olmayan
  servisler için kullanışlıdır

WS-Security yerleşik olarak gelir (UsernameToken, Timestamp, XML İmzası, XML
Şifreleme). [WS-Security kılavuzu →](/tr/docs/ws-security)

## WebSocket

`ws://` veya `wss://` adreslerine özel header'larla bağlanın. Mesajlar bir
zaman çizelgesinde görünür (zaman damgalarıyla birlikte gönderilen + alınan). Mesajları JSON veya metin olarak oluşturun.

[Tam referans →](/tr/docs/protocols/websocket)

## GraphQL

Sorgu, mutasyon ve abonelik desteği. Testnizer, uç noktanızın yalnızca HTTP mi
yoksa `graphql-ws` (abonelik transport) destekleyip desteklemediğini algılar
ve buna göre yönlendirir.

Şema içgözlemi isteğe bağlı olarak çalıştırılır ve istek editörünün sağ tarafında
aranabilir bir tür tarayıcısını doldurur.

[Tam referans →](/tr/docs/protocols/graphql)

## gRPC

Bir `.proto` dosyası seçin. Testnizer servisleri ve metodları listeler, istek mesajları
için JSON iskeletleri oluşturur ve bunları doldurmanıza olanak tanır.

Streaming modları:

- **Unary** — tek istek, tek yanıt
- **Server-streaming** — tek istek, yanıt akışı
- **Client-streaming** — istek akışı, tek yanıt
- **Bidirectional** — her iki taraf da akar

Metadata (istek ve yanıt) düzenlenebilir. TLS / mTLS projenizin
sertifika deposunu kullanır.

[Tam referans →](/tr/docs/protocols/grpc)

## Server-Sent Events

Bir SSE uç noktasında Gönder'e tıklayın; Testnizer bağlantıyı açık tutar ve
gelen olayları ayrıştırır. Last-Event-ID header'ı yeniden bağlanmada otomatik olarak ayarlanır,
böylece sunucu kaldığı yerden devam edebilir.

## Socket.IO

Bir Socket.IO sunucusuna namespace ve isteğe bağlı bir bearer token ile bağlanın.
Resmi `socket.io-client` ana süreçte çalışır — Testnizer WebSocket transport'unu
HTTP long-polling fallback ile müzakere eder, renderer yalnızca event'leri görüntüler.

Akış:

- URL'yi (örn. `http://localhost:3000`), namespace'i (`/` veya `/admin`) ve
  isteğe bağlı bearer token'ı girin
- **Connect**'e tıklayın — Testnizer `connect` ack'ını bekler, el sıkışma
  başarısız olursa `connect_error` mesajını gösterir
- Herhangi bir event'i JSON yüküyle **Emit** edin (event adı + gövde)
- Herhangi bir event adına **Subscribe** olun; gelen event'ler zaman çizelgesine akar
- Çift yönlü zaman çizelgesi giden emit'ler için `↑`, gelen event'ler için `↓`
  ve zaman damgaları gösterir

[Tam referans →](/tr/docs/protocols/socketio)

## MCP (Model Context Protocol)

Testnizer bir MCP **istemcisidir**. MCP sunucularına bağlanır, araçlarını keşfeder
ve onları argümanlarla çağırır — Claude Desktop'un bir aracı çağırırken üstlendiği
rolün aynısı. Resmi `@modelcontextprotocol/sdk` üzerine kuruludur.

Üç transport:

- **Streamable HTTP** — modern HTTP transport'unu sunan uzak MCP sunucuları için
  (örn. `https://mcp.example.com/mcp`)
- **SSE (eski)** — eski HTTP+SSE tabanlı MCP sunucuları için
- **stdio** — Testnizer sunucuyu yerel bir alt süreç olarak başlatır. Tam komutu
  girin (örn. `npx @modelcontextprotocol/server-everything`)

Bağlandıktan sonra **Tools** paneli sunucunun yayınladığı her aracı input
şemasıyla birlikte listeler. Bir aracı seçin, JSON argümanları doldurun,
**Invoke**'a tıklayın ve yapılandırılmış sonucu inceleyin.

[Tam referans →](/tr/docs/protocols/mcp)

## AI Chat

Bir sağlayıcı seçin (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Groq,
Perplexity, Cerebras, Cohere, Fireworks, DeepInfra, Together, OpenRouter) veya
kendi barındırdığınız vLLM / LM Studio / Ollama / TGI için **Özel URL** seçin.

Konuşmalar sistem prompt'u ile birlikte çok turludur. Yanıtlar varsayılan olarak
akıtılır. Değişkenler (`{{apiKey}}`) URL, header'lar ve gövdede çözülür — API
anahtarlarını isteğin içinde değil, proje ortamında saklamak için kullanışlıdır.
