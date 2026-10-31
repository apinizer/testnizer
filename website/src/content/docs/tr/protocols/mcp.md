---
title: MCP (Model Context Protocol)
description: Testnizer bir MCP istemcisidir. MCP sunucularına Streamable HTTP, SSE veya stdio üzerinden bağlanın; araçları listeleyin ve çağırın.
order: 9
section: Protokoller
---

**Model Context Protocol** (MCP) — Anthropic tarafından yayınlanan ve Claude
Desktop, IDE eklentileri ve diğer AI host'ları tarafından benimsenen açık
spec — bir dil modeli host'unun harici **araçlarla** standart bir şekilde
konuşmasını sağlar. Bir MCP sunucusu araç listesini (girdileri için JSON
şemalarıyla birlikte) sunar; bir MCP istemcisi (bu durumda Testnizer) bunları
keşfeder ve çağırır.

Testnizer bir MCP **istemcisidir**. MCP sunucularına bağlanır, araçlarını
listeler ve herhangi bir aracı argümanlarla çağırmanıza izin verir. Şunlar
için kullanın:

- Geliştirmekte olduğunuz yeni bir MCP sunucusunun protokol el sıkışmasına
  ve `tools/list`'e doğru yanıt verdiğini doğrulayın.
- Üçüncü taraf bir MCP sunucusunu Claude Desktop'a bağlamadan önce deneyin.
- Bir host başlatmadan geliştirme sırasında araç çağrılarını smoke test edin.

Testnizer resmi `@modelcontextprotocol/sdk` üzerine kurulduğundan, wire
protokolü diğer host'ların konuştuğuyla bit bit aynıdır.

## MCP sekmesi açma

**+ Yeni** → **MCP** tıklayın. Editör bir transport seçici, bir URL veya
komut alanı, bir Connect butonu ve boş bir araç listesi ile açılır.

## Transport seçimi

MCP üç transport tanımlar. Testnizer hepsini destekler.

### Streamable HTTP

Mevcut MCP HTTP transport'u. `https://mcp.example.com/mcp` gibi bir URL'de
sunulan uzak MCP sunucuları için bunu kullanın.

- **Transport**: `Streamable HTTP`
- **URL**: tam sunucu URL'si (yol dahil)
- **Connect** el sıkışmayı başlatır — Testnizer sunucuya
  `Testnizer / 1.0.0` olarak tanımlanır.

### SSE (eski)

Eski sunucularla uyumluluk için tutulan önceki HTTP+SSE tabanlı transport.
Sunucu dokümantasyonu açıkça SSE'den bahsediyorsa bunu kullanın.

- **Transport**: `SSE (legacy)`
- **URL**: SSE uç noktası URL'si

### stdio (yerel alt süreç)

Komut satırı araçları olarak dağıtılan MCP sunucuları için (örn. npm'de).
Testnizer **sunucuyu bir alt süreç olarak başlatır** ve onun
stdin/stdout'u üzerinden JSON-RPC konuşur — ağ söz konusu değildir.

- **Transport**: `stdio (local)`
- **URL alanı**: tam komut satırı, örn.
  `npx @modelcontextprotocol/server-everything` veya
  `node /path/to/my-mcp-server.js`

İlk boşlukla ayrılmış token executable olarak kabul edilir; geri kalanı
argüman olarak iletilir. Ortam değişkenleri Testnizer'ın süreç ortamından
miras alınır.

## Bağlanma

**Connect**'e tıklayın. Testnizer:

1. Seçilen transport'u açar (HTTP isteği, SSE akışı veya alt süreç).
2. MCP initialize el sıkışmasını gerçekleştirir.
3. Başarılı olursa, sunucunun bildirdiği ad ve sürüm (`getServerVersion()`)
   Connect butonunun yanında görünür ve buton kırmızı bir **Disconnect**
   olur.
4. Soldaki araç listesi `tools/list`'ten otomatik olarak doldurulur.

Araçlar, başarılı bir bağlantının hemen ardından **otomatik olarak listelenir** —
ayrı bir "Araçları listele" düğmesine tıklamanız gerekmez.

El sıkışma başarısız olursa, hata bağlantı çubuğunun yanında gösterilir
(ulaşılamayan URL, komut bulunamadı, sürüm uyuşmazlığı vb.).

## Araç listesi

Sunucunun yayınladığı her araç sol panelde görünür:

- **Ad** — modelin başvuracağı araç tanımlayıcısı
- **Açıklama** — sağlandıysa, sunucudan gelen okunabilir açıklama
- **Input schema** — bir aracı seçtiğinizde, JSON Schema'sı argümanlar
  textarea'sının üstünde gösterilir, böylece sunucunun ne beklediğini
  görebilirsiniz

## Bir aracı çağırma

1. Bir aracı seçmek için tıklayın.
2. **Arguments (JSON)** textarea'sını düzenleyin. Input schema'sı olan bir araç
   seçtiğinizde, Testnizer şemadan oluşturulan bir iskelet JSON ile argümanlar
   textarea'sını **otomatik olarak önceden doldurur** — dizeler `""` olur, sayılar
   `0`, boolean'lar `false`, diziler `[]`, enum'lar ise ilk değeri alır. İhtiyacınız
   olan değerleri düzenleyin; geri kalanı sıfır değerlerinde kalabilir. Değişkenler
   burada da çözülür (`{"path": "{{workspaceRoot}}/file.txt"}`).
3. **Invoke `<tool-name>`** tıklayın.
4. Sunucudan gelen yapılandırılmış sonuç aşağıdaki **Result** bölmesinde
   görünür. MCP sonuçları typed bir payload olarak döner (metin, JSON,
   görsel referansları vb.), tümü pretty-print edilmiş.
5. Sunucu bir hata döndürürse (doğrulama hatası, çalışma zamanı hatası
   vb.), sonuç yerine hata mesajı kırmızı renkte gösterilir.

## Bağlantıyı kesme

Transport'u kapatmak için **Disconnect**'e tıklayın. stdio transport'ları
için bu aynı zamanda alt süreci sonlandırır. Araç listesi temizlenir;
son sonuç bir sonraki çağırmaya kadar ekranda korunur.

## Çoklu sekme yalıtımı

Her MCP sekmesi kendi bağlantısını, transport seçimini, araç listesini,
seçili aracını ve son sonucunu korur. İki MCP sunucusu uygulamasını yan
yana karşılaştırmak için veya bir sekmede uzun süreli bir stdio sunucusu
bağlı tutarken bir başka sekmede HTTP sunucusu üzerinde iterasyon yapmak
için birden çok sekme açın.

## Güvenlik notları

- **stdio transport süreçleri başlatır.** Yalnızca güvendiğiniz komutları
  çağırın — Testnizer alt süreci host işletim sisteminin sağladığının
  ötesinde sandbox'layamaz.
- **Uzak MCP sunucuları** Testnizer'ın IP adresini ve bir araca ilettiğiniz
  argümanları görür. Harici bir hizmete yapılan herhangi bir HTTP API
  çağrısıyla aynı şekilde değerlendirin.
- **Otomatik olarak hiçbir gizli bilgi gönderilmez.** HTTP MCP sunucuları
  için kimlik doğrulama, sunucunuz gerektiriyorsa URL'nin kendisine
  bağlanmalıdır (örn. bir query parametresinde token ile); native MCP auth
  akışları gelişmektedir ve spec stabilleştikçe eklenecektir.
