# Testnizer — Live Demo Endpoints

Tüm aşağıdaki endpoint'ler bu makineden `curl` ile gerçek istekler gönderilerek doğrulandı. Sonuçlar tek seferlik canlı kontroldür; rate-limit, coğrafi engel, geçici outage gibi durumlarda farklı sonuç alınabilir.

---

## HTTP / HTTPS (REST)

| Protocol | URL | Method | Doğrulama komutu | Sonuç |
|---|---|---|---|---|
| HTTPS | `https://httpbin.org/get` | GET | `curl -sS -o /dev/null -w '%{http_code}\n' https://httpbin.org/get` | **200** |
| HTTPS | `https://httpbin.org/post` | POST | `curl -X POST -d 'a=1' -sS -o /dev/null -w '%{http_code}\n' https://httpbin.org/post` | **200** |
| HTTPS | `https://httpbin.org/status/418` | GET | `curl -sS -o /dev/null -w '%{http_code}\n' https://httpbin.org/status/418` | **418** (kasıtlı status testi) |
| HTTPS | `https://httpbin.org/delay/2` | GET | `curl --max-time 5 -sS -o /dev/null -w '%{http_code}\n' https://httpbin.org/delay/2` | **200** (~2s — timeout testi) |
| HTTPS | `https://jsonplaceholder.typicode.com/posts/1` | GET | `curl -sS -o /dev/null -w '%{http_code}\n' https://jsonplaceholder.typicode.com/posts/1` | **200** |
| HTTPS | `https://jsonplaceholder.typicode.com/posts` | POST | `curl -X POST -H 'Content-Type: application/json' -d '{"title":"t"}' -sS -o /dev/null -w '%{http_code}\n' .../posts` | **201** |
| HTTPS | `https://jsonplaceholder.typicode.com/posts/1` | PUT | `curl -X PUT -H 'Content-Type: application/json' -d '{"id":1}' .../posts/1` | **200** |
| HTTPS | `https://jsonplaceholder.typicode.com/posts/1` | PATCH | `curl -X PATCH -H 'Content-Type: application/json' -d '{"title":"x"}' .../posts/1` | **200** |
| HTTPS | `https://jsonplaceholder.typicode.com/posts/1` | DELETE | `curl -X DELETE .../posts/1` | **200** |
| HTTPS | `https://postman-echo.com/get` | GET | `curl -sS -o /dev/null -w '%{http_code}\n' https://postman-echo.com/get` | **200** |

> Not: `reqres.in` ham `curl` UA'sından **401** dönüyor (Cloudflare/AI tarama koruması); tarayıcı/Postman'dan 200 verir. Demo listesinden çıkarıldı.

---

## SOAP / WSDL

| Protocol | URL | Operasyon | Doğrulama komutu | Sonuç |
|---|---|---|---|---|
| SOAP 1.1/1.2 | `http://www.dneonline.com/calculator.asmx?WSDL` | Add, Subtract, Multiply, Divide (4 op, multi-binding) | `curl -sS -o /dev/null -w '%{http_code}\n' 'http://www.dneonline.com/calculator.asmx?WSDL'` | **200** + `<wsdl:definitions>` |
| SOAP | `https://www.dataaccess.com/webservicesserver/NumberConversion.wso?WSDL` | NumberToWords, NumberToDollars | `curl -sS -o /dev/null -w '%{http_code}\n' '...NumberConversion.wso?WSDL'` | **200** |
| SOAP | `http://webservices.oorsprong.org/websamples.countryinfo/CountryInfoService.wso?WSDL` | CountryName, CountryISOCode, FullCountryInfo, ~25 op | `curl -sS -o /dev/null -w '%{http_code}\n' '...CountryInfoService.wso?WSDL'` | **200** |
| SOAP | `https://www.w3schools.com/xml/tempconvert.asmx?WSDL` | CelsiusToFahrenheit, FahrenheitToCelsius | aynı format | **200** (öğretici amaçlı, hafif) |

---

## WebSocket

| Protocol | URL | Notlar | Doğrulama | Sonuç |
|---|---|---|---|---|
| WSS | `wss://echo.websocket.org` | Açıklayıcı banner mesajı + echo | curl Upgrade handshake | **101 Switching Protocols** |
| WSS | `wss://ws.postman-echo.com/raw` | Saf raw echo (banner yok) | aynı handshake | **101 Switching Protocols** |
| WSS | `wss://stream.binance.com:9443/ws/btcusdt@trade` | Canlı BTC/USDT trade akışı (read-only public) | aynı handshake | **101 Switching Protocols** |

curl handshake komutu:
```
curl -i --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://echo.websocket.org/
```

> Not: `wss://socketsbay.com/wss/v2/1/demo/` ve `wss://ws.ifelse.io/` denenmiş ancak Cloudflare 523 / no-response döndü — listeden çıkarıldı.

---

## GraphQL

| Protocol | URL | Sample query | Doğrulama | Sonuç |
|---|---|---|---|---|
| GraphQL | `https://countries.trevorblades.com/graphql` | `{ country(code:"TR"){ name capital } }` | `curl -X POST -H 'Content-Type: application/json' -d '{"query":"..."}' ...` | **200** — `{"data":{"country":{"name":"Turkey","capital":"Ankara"}}}` |
| GraphQL | `https://rickandmortyapi.com/graphql` | `{ character(id:1){ name status } }` | aynı | **200** — `{"data":{"character":{"name":"Rick Sanchez","status":"Alive"}}}` |
| GraphQL | `https://graphqlzero.almansi.me/api` | `{ post(id:1){ title } }` | aynı | **200** |

Üçü de **introspection açık** — Testnizer'in GraphQL editörü `__schema` sorgusu ile schema'yı otomatik yükleyebilir.

> Not: `https://spacex-production.up.railway.app/` (eski popüler SpaceX GraphQL demo) artık **404** veriyor — listeden çıkarıldı.

---

## gRPC / Connect-RPC

| Protocol | URL | Method | Doğrulama | Sonuç |
|---|---|---|---|---|
| Connect-RPC (HTTP/JSON) | `https://demo.connectrpc.com/connectrpc.eliza.v1.ElizaService/Say` | `Say` (unary) | `curl -X POST -H 'Content-Type: application/json' -d '{"sentence":"hi"}' .../Say` | **200** + `{"sentence":"Hi there...how are you today?"}` (HTTP/2) |
| Connect-RPC (Connect stream) | `https://demo.connectrpc.com/connectrpc.eliza.v1.ElizaService/Converse` | `Converse` (server-stream / bidi-stream Connect protokolü) | aynı host, `Content-Type: application/connect+json` | 200 (akış açılır) |
| gRPC native + gRPC-Web | `https://demo.connectrpc.com:443` | tüm Eliza service | `curl --http2 -o /dev/null -w '%{http_version}\n' https://demo.connectrpc.com` | `http_version=2` |

> Notlar:
> - `demo.connectrpc.com` **tek port (443)** üzerinden 3 protokolü servis eder: native gRPC (HTTP/2 + protobuf), gRPC-Web, Connect (JSON & protobuf). Plaintext gRPC için ayrı port yok — TLS zorunlu.
> - Eliza .proto: <https://github.com/connectrpc/examples-go/blob/main/proto/connectrpc/eliza/v1/eliza.proto>
> - `grpcb.in:9000/9001` bu makineden bağlanılamadı (kurumsal/ISP firewall olabilir) — listeden çıkarıldı.

---

## SSE (Server-Sent Events)

| Protocol | URL | İçerik | Doğrulama | Sonuç |
|---|---|---|---|---|
| SSE | `https://stream.wikimedia.org/v2/stream/recentchange` | Tüm Wikimedia projelerindeki canlı düzenlemeler — saniye aralıklı `data:` event'leri | `curl -N --max-time 4 -H 'Accept: text/event-stream' ...` | **200** — `event: message` + `data: {"$schema":"/mediawiki/recentchange/1.0.0",...}` satırları akar |
| SSE | `https://stream.wikimedia.org/v2/stream/page-create` | Sadece yeni sayfa oluşturma event'leri (daha düşük hızda) | aynı | **200** — `event: message` + `data: {"$schema":"/mediawiki/revision/create/2.0.0",...}` |
| SSE | `https://demo.mercure.rocks/.well-known/mercure?topic=https://example.com/demo` | Mercure hub demosu — keepalive (`:`) comment'leri akar; gerçek event görmek için aynı topic'e ayrıca POST publish gerekir | aynı | **200** (akış açılıyor, default'ta sadece keepalive) |

> Not: `https://sse.dev/test` artık SSE servis etmiyor; `/lander` (marketing sayfa) yönlendirmesi yapan bir HTML döndürüyor — listeden çıkarıldı.

---

## MCP (Model Context Protocol)

| Transport | URL | Method / Mesaj | Doğrulama | Sonuç |
|---|---|---|---|---|
| Streamable HTTP | `https://mcp.context7.com/mcp` | POST `initialize` | `curl -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' https://mcp.context7.com/mcp` | **200** + `{"result":{"protocolVersion":"2024-11-05","capabilities":{...},"serverInfo":{"name":"Context7","version":"2.2.4"}}}` |
| Streamable HTTP | `https://mcp.context7.com/mcp` | POST `tools/list` | Connection ID alındıktan sonra `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}` | **200** + tool listesi (resolve-library-id, get-library-docs) |
| Streamable HTTP | `https://mcp.context7.com/mcp` | POST `tools/call` | `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"resolve-library-id","arguments":{"libraryName":"react"}}}` | **200** + `{"content":[{"type":"text","text":"/facebook/react"}]}` |

**Testnizer'da örnek akış:**
```
Transport: Streamable HTTP
URL: https://mcp.context7.com/mcp
```
→ **Connect** → Tool listesi otomatik yüklenir → `resolve-library-id` seç → Arguments: `{"libraryName":"react"}` → **Call Tool** → Yanıt: `/facebook/react`

> Not: Context7, ücretsiz ve kayıtsız MCP sunucusudur. Rate-limit uygulanabilir; bağlantı hatası alınırsa birkaç saniye bekleyip tekrar deneyin.

Ek test komutu — sunucu canlı mı kontrol:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  https://mcp.context7.com/mcp
# Beklenen çıktı: 200
```

---

## Socket.IO

Güvenilir **ücretsiz kamuya açık** Socket.IO sunucusu mevcut değildir — protokol özel namespace, auth token ve event şeması gerektirdiğinden herkese açık stabil sunucu yoktur.

### Yerel test sunucusu (node — ~1 satır)

Node.js ve `socket.io` paketi kurulu sistemde:

```bash
node -e "
const http = require('http');
const { Server } = require('socket.io');
const srv = http.createServer().listen(3001, () => console.log('Socket.IO dinleniyor: http://localhost:3001'));
new Server(srv, { cors: { origin: '*' } }).on('connection', socket => {
  console.log('Bağlandı:', socket.id);
  socket.onAny((event, data) => {
    console.log('<-- Gelen:', event, data);
    socket.emit('echo', { event, data });   // her event'i 'echo' olarak geri gönder
  });
});
"
```

Testnizer'da:
```
URL:       http://localhost:3001
Namespace: /   (varsayılan)
Auth:      {}  (boş — bu demo için)
```
→ **Connect** → Subscribe: `echo` → Emit: event=`ping` data=`{"msg":"merhaba"}` → `echo` kanalında `{"event":"ping","data":{"msg":"merhaba"}}` görünür.

### Ücretli/kurumsal test ortamları

| Servis | URL | Notlar |
|---|---|---|
| Socket.IO resmi playground | (henüz yok) | Proje, kamuya açık demo sunmamaktadır |
| Ably sandbox | `wss://realtime.ably.io` | Socket.IO adapter mevcut, ücretsiz plan var |
| Pusher Channels | `wss://ws-us3.pusher.com/app/<key>` | Socket.IO benzeri, ayrı protokol — doğrudan uyumlu değil |

---

## AI Chat (anahtar kullanıcıdan)

Bu protokol Testnizer'da kullanıcının kendi API anahtarını ister; ortak bir demo endpoint **yok**. Connectivity sağlık kontrolleri:

| Provider | URL | Doğrulama | Sonuç |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1/models` | `curl -sS -o /dev/null -w '%{http_code}\n' ...` | **401** (anahtarsız — endpoint canlı) |
| Anthropic | `https://api.anthropic.com/v1/messages` | `curl -X POST ...` | **401** (anahtarsız — endpoint canlı) |
| Groq | `https://api.groq.com/openai/v1/models` | `curl ...` | **401** (anahtarsız — endpoint canlı) |
| Ollama (yerel) | `http://localhost:11434/api/tags` | `curl --max-time 2 ...` | Yerel kurulum bağımlı (Ollama yüklüyse 200) |

---

## Testnizer içinde nasıl test edilir (kısa rehber)

- **HTTP/REST** — URL bar: method dropdown'dan GET/POST/.. seç, URL'yi yapıştır, **Send**. JSON body için "Body" tab → JSON; query için "Params". Cevap sağ panel "Response" → Body.
- **SOAP** — Yeni request → protokol "SOAP" → WSDL URL'sini yapıştır, **Load**. Sol ağaçtan operasyon seç (örn. `Add`); envelope otomatik üretilir, parametreleri doldur, **Send**. Cevap "Response" → XML.
- **WebSocket** — Yeni request → "WebSocket" → URL `wss://echo.websocket.org` → **Connect**. Üst log "OPEN" gösterir; alt mesaj kutusuna metin yaz, **Send** → echo cevabı `<` prefiksiyle log'a düşer.
- **GraphQL** — "GraphQL" → URL `https://countries.trevorblades.com/graphql` → **Fetch schema** (introspection). "Query" sekmesine `{ countries { code name } }` yaz, **Send**. Sağ panelde JSON.
- **gRPC / Connect-RPC** — "gRPC" → endpoint `demo.connectrpc.com:443` (TLS açık), Eliza .proto'yu yükle, method `Say` seç, payload `{"sentence":"hi"}`, **Invoke**. Connect-RPC modunda yol otomatik `/connectrpc.eliza.v1.ElizaService/Say`.
- **SSE** — "SSE" → URL `https://stream.wikimedia.org/v2/stream/recentchange` → **Connect**. Event listesi saniyeler içinde dolar; "Filter" ile `data` içeriğine arama yapabilirsin. Durdurmak için **Disconnect**.
- **AI Chat** — Settings → AI Providers'da kendi anahtarını gir (OpenAI/Anthropic/Groq), sonra "AI Chat" tab'ında modeli seç, mesajı yaz, **Send**. Stream cevap baloncukta canlı yazılır.
- **MCP** — Yeni request → "MCP" → Transport: `Streamable HTTP`, URL: `https://mcp.context7.com/mcp` → **Connect**. Tool listesi otomatik yüklenir. Bir tool seç (örn. `resolve-library-id`), Arguments kutusuna `{"libraryName":"react"}` yaz, **Call Tool**.
- **Socket.IO** — Önce terminalde yukarıdaki yerel sunucu komutunu çalıştır (port 3001). Yeni request → "Socket.IO" → URL: `http://localhost:3001` → **Connect**. "Subscribe" sekmesinde `echo` event'ini ekle. "Emit" sekmesinde event=`ping`, data=`{"msg":"test"}` yaz → **Emit**. Event log'unda gelen echo cevabını gör.
