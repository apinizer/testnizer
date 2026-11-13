---
title: AI (LLM) mock sunucu
description: OpenAI ve Anthropic tel biçimlerini konuşan ve hazır yanıtları akıtan yerel bir sohbet API'si; token harcamadan bir AI istemcisini, araç çağrılarını ve sağlayıcı hatalarını test edin.
order: 4
section: Mock sunucular
---

AI mock sunucu bir LLM sağlayıcısı gibi cevap verir, ama yanıtları sizin yazdığınız
metinlerdir. **OpenAI sohbet API'sini** (`POST /v1/chat/completions`,
`GET /v1/models`) ve **Anthropic mesajlar API'sini** (`POST /v1/messages`) konuşur;
istemci akış istediğinde yanıtı akıtır, istemediğinde tek bir JSON gövdesiyle cevap verir.

Neden kullanılır:

- **Token yok, ağ yok.** Bir AI istemcisi geliştirin, test yazın ya da uçakta demo yapın.
- **Deterministik hatalar.** Gerçek bir sağlayıcı, tam ihtiyacınız olduğunda 429,
  529 `overloaded_error` ya da birkaç kelimeden sonra kopan bir akış döndürmez. Mock
  bunu istediğinizde, her seferinde yapar.
- **Araç çağrısı gidiş-dönüşleri.** Bir [MCP mock sunucuyla](/tr/docs/mock-server/mcp)
  birlikte, istemcinin araç sonucunu geri gönderdiğini ve son yanıtı işlediğini kontrol edin.

[HTTP mock sunucuyla](/tr/docs/mock-server/http) aynı HTTP motorunda çalışır; bu yüzden
uç noktalar, koşullar, şablonlama, kimlik doğrulama ve Loglar sekmesi aynı şekilde
işler. Kimlik doğrulama varsayılan olarak kapalıdır. Mock sunucuların genel olarak
oluşturulması, başlatılması ve açılması için [genel bakışa](/tr/docs/mock-server) bakın.

## Hazır şablonlar

Yeni mock sunucu penceresinde bir şablon seçin (tür **AI**) ya da **Boş**'tan başlayın:

| Şablon | Ne oluşturur |
|---|---|
| **OpenAI uyumlu sohbet** | `POST /v1/chat/completions` ve `GET /v1/models`: metin yanıtını kelime kelime akıtır; `stream: false` JSON ile cevap verir |
| **Anthropic mesajları** | `POST /v1/messages`: `message_start` ... `message_stop` olay akışı; `x-api-key` gerekmez |
| **Araç çağrısı gidiş-dönüş** | `POST /v1/chat/completions`: ilk tur isteğin sunduğu echo aracını çağırır; araç sonucunu taşıyan tur son yanıtı alır. Mock MCP **Echo** şablonuyla birlikte kullanın |
| **Anthropic araç kullanımı gidiş-dönüş** | Aynısı `POST /v1/messages` üzerinden, bir `tool_use` bloğu ve bir `tool_result` ile |
| **Hatalar** | İsteğin model adına göre seçilir: `error-429` `retry-after` ile 429, `error-500` 500, `error-401` 401 döndürür, `error-stream` birkaç kelime akıtıp akışın ortasında bozulur. `/v1/messages` üzerinde: `error-529` bir `overloaded_error`, `error-stream` akışın ortasında `event: error` gönderir. Başka her model normal yanıt alır |

Editör başlığı sunucu URL'sini ve bir **SDK temel URL'si** gösterir (sunucu URL'si
artı `/v1`). Her OpenAI ya da Anthropic SDK'sı bu temel URL ile çalışır.

## Yanıt

AI yanıtı, gövde türü **AI yanıtı** olan bir uç nokta yanıtıdır. Gövdesi asistanın
metnidir; isteği okuyabilen bir şablondur:

| Şablon | Anlamı |
|---|---|
| `{{lastUserMessage}}` | Son kullanıcı mesajının metni (araç sonucu turu atlanır; bu yüzden kişinin yazdığı metin kalır) |
| `{{lastToolResult}}` | İstekteki son araç sonucunun içeriği |
| `{{model}}` | İsteğin adlandırdığı `model` (boşsa `mock-model` okunur) |

Diğer tüm [şablonlama](/tr/docs/mock-server/http) de çalışır. `temperature`,
`max_tokens`, `n` gibi istek alanları ve `tools` şemaları yok sayılır; yanıt mock'un
tanımından gelir. `messages` içeren bir JSON nesnesi olmayan gövde, gerçek API'nin
verdiği 400'ü alır.

Yanıtın **Gecikme (ms)** değeri ilk token'a kadarki süredir. İsteğin `stream` bayrağı
akış ile tek JSON yanıtı arasında karar verir. Durumu 200-299 dışında olan bir yanıt
akıtılmaz: gövdesi yazıldığı gibi gönderilir; hata şablonları böyle çalışır.

### LLM satırı

![Üç yanıt ve LLM satırıyla AI mock editörü: sağlayıcı, parçalama, durma nedeni ve kullanım](/docs/screenshots/mock-server-ai-editor.png)

| Ayar | Seçenekler |
|---|---|
| **Sağlayıcı** | **OpenAI uyumlu** ya da **Anthropic** tel biçimi |
| **Parçalama** | **Kelime** (varsayılan), **Karakter**, **Cümle**, **Sabit boyut** (varsayılan 8 karakter) ya da **Tüm mesaj** |
| **Parça aralığı (ms)** | Parçalar arası bekleme, varsayılan 30 |
| **Durma nedeni** | Her sağlayıcının kendi değerleri, o sağlayıcının adlandırdığı biçimde: OpenAI `stop`, `length`, `content_filter`, `tool_calls`; Anthropic `end_turn`, `max_tokens`, `stop_sequence`, `refusal`, `tool_use`. Anthropic `stop_sequence` için ayrıca diziyi de verirsiniz (varsayılan `END`) |
| **Kullanım** | **Otomatik** (belirteç başına yaklaşık 4 karakter) ya da **Özel** giriş ve çıkış belirteç sayıları |
| **Araç çağrıları** | `{"name": ..., "arguments": {...}}` öğelerinden oluşan JSON listesi, isteğe bağlı `"id"`; içlerindeki metinler şablondur. Araç çağrısı olan yanıt her zaman araç çağrısı nedeniyle biter. Yanıt başına en çok 16 |
| **Akış ortasında hata** | Aşağıya bakın |

`{{offeredTool 'echo'}}`, isteğin echo aracını hangi adla sunduğunu verir: `echo` ya da
Testnizer'ın AI Chat'i bir MCP sunucusunun araçlarını eklediyse `<sunucu>__echo`. Araç
çağrısı şablonları bunu kullanır.

Belirteç kullanımı yanıtın parçasıdır: akıtılan bir OpenAI yanıtının son parçasında,
bir Anthropic akışının `message_start` ve `message_delta` olaylarında. `stream_options.include_usage`
ile bir OpenAI akışı ayrıca OpenAI'ın kendi kullanım parçasını da gönderir; bu yüzden
kullanımı parçalar boyunca toplayan bir istemci onu iki kez sayar.

### Bilerek bozma

Hata şablonlarının ötesinde, akıtılan her yanıt ortasında bozulabilir. **Akış ortasında
hata**'yı açın; hatadan önce gönderilecek parça sayısını ve hata **Türü** ile
**Mesajı**'nı seçin:

- **OpenAI uyumlu**: o kadar metin ya da araç argümanı parçasından sonra adsız bir
  `data: {"error": {...}}` olayı gönderilir ve akış kapanır; bitiş parçası ya da `[DONE]`
  olmaz. Boş tür ve mesaj OpenAI'ın kendi `server_error` metnini kullanır.
- **Anthropic**: `{"type": "error", "error": {...}}` ile `event: error` gönderilir ve
  akış kapanır; `message_delta` ya da `message_stop` olmaz. Boş tür ve mesaj
  `overloaded_error` / "Overloaded" kullanır.

Yalnızca akıtılan yanıtlar etkilenir; düz JSON yanıtı etkilenmez. Bu, bir istemcinin
zaten aldığı metni koruyup hatayı onun altında gösterip göstermediğini sınar. Testnizer'ın
kendi [AI Chat](/tr/docs/protocols/ai-chat) sekmesi bunu yapar.

## Bir istemciyi ona yöneltme

- **AI Chat sekmesinde aç** / **Başlat ve AI Chat sekmesinde aç**, Testnizer'ın AI
  Chat'ini ilk `POST .../chat/completions` uç noktasında, sağlayıcı özel URL ve model
  `mock-model` olarak açar. **AI Chat sekmesinde aç (Anthropic)** aynısını bir
  `POST .../messages` uç noktası için Anthropic sağlayıcısında yapar.
- Mock'tan açılan bir sohbet sekmesi **kayıtlı sağlayıcı anahtarınızı yüklemez**; böylece
  gerçek bir anahtar sağlayıcı olmayan bir sunucuya gitmez. O sekmede yazdığınız anahtar
  yalnızca o sekmede kullanılır. Bir AI Chat sekmesini mock'a kendiniz Anthropic
  sağlayıcısında yöneltirseniz kayıtlı anahtarınız `x-api-key` olarak gönderilir; bu
  localhost'ta zararsızdır, ancak oraya yazdığınız bir token kayıtlı anahtarınızın yerini alır.
- Herhangi bir SDK: başlıktaki **SDK temel URL'sini** ve herhangi bir API anahtarı
  metnini kullanın; kimlik doğrulamayı açmadıysanız.

## Sınırlar

Akıtılan bir yanıt, bir [SSE akışıyla](/tr/docs/mock-server/sse) aynı şekilde sınırlıdır:
en çok 10.000 parça, sunucu başına 64 açık akış ve aşırı büyük bir parça hatadır. Parça
sınırına takılırsanız metni daha büyük parçalara bölün (**Cümle**, **Sabit boyut** ya da
**Tüm mesaj**).

Loglar sekmesinde bir akış, kapanana kadar **akış sürüyor...** olarak işaretlenmiş tek
bir satırdır.

## İlgili sayfalar

- [AI Chat](/tr/docs/protocols/ai-chat): istemci tarafı, sohbette MCP araçları dahil
- [MCP mock sunucu](/tr/docs/mock-server/mcp): araç çağrısı şablonlarıyla birlikte kullanın
