---
title: İstek geçmişi
description: Testnizer'ın yerel geçmiş panelinden geçmiş isteklere göz atın, tekrar oynatın ve temizleyin.
order: 4
section: Referans
---

## Neler kaydedilir

Gönderdiğiniz her istek, her protokol için, isteğin ve yanıtın bir anlık
görüntüsüyle otomatik olarak kaydedilir. Geçmiş makinenizdeki yerel SQLite
veritabanında (`testnizer.db`) saklanır ve ağ üzerinden hiçbir şey iletilmez.

Her geçmiş girdisi şunları içerir:

- **Method ve URL**
- **Durum, yanıt süresi ve boyutu**
- **İstek ve yanıt**, yeniden açabileceğiniz bir anlık görüntü olarak
- Ait olduğu **proje**; liste etkin projenin girdilerini gösterir

### Kimlik bilgileri saklanmadan önce maskelenir

Kimlik bilgileri Geçmiş veritabanına asla düz metin olarak ulaşmaz. Bir satır
yazılmadan önce Testnizer şunları maskeler:

- kimlik bilgisi taşıyan header'lar (`Authorization`, `Cookie`, API anahtarı
  header'ları ve benzerleri)
- kimlik bilgisi taşıyan query ve gövde alanları, her derinlikte; JSON, form ve
  XML / SOAP gövdeleri dahil
- URL içindeki `user:pass@`
- **secret** değişkenlerinizin değerleri ve yanıtlardaki token alanları
  (`access_token`, `refresh_token` ve benzerleri)
- uygulama düzeyi ve proje proxy'lerinin parolası

Bir istek gövdesinde gönderdiğiniz kimlik bilgisi, sunucu onu başka bir adla geri
yankılasa bile her yerde maskelenir. WebSocket, Socket.IO, SSE, GraphQL ve gRPC
sekmeleri aldıkları mesajları diske yazmaz; bunlar oturum boyunca bellekte kalır.
Eski sürümlerin yazdığı satırlar, 1.6.0'ın ilk açılışında bir kez maskelenir.

Geçmiş, bir isteğin `{{değişken}}` şablonunu korur; böylece istek, değişkenlerinizin
güncel değerleriyle yeniden gönderilebilir. Bir kimlik bilgisi maskelendiyse yeniden
açılan istek bir not gösterir ("Kimlik bilgileri Geçmiş'te saklanmadı — yeniden
girin") ve o alanı boş bırakır.

---

## Geçmişe göz atma

Sol kenar çubuğundaki **Geçmiş** sekmesini açın. İki liste vardır:

- **İstekler** — gönderdiğiniz istekler, güne göre gruplanmış (Bugün, Dün ve daha
  eskiler). Tam URL'yi görmek için bir satırın üzerine gelin.
- **Commit'ler** — etkin projenin Git branch'inin commit geçmişi.

Listeyi URL'ye ya da method'a göre daraltmak için **Geçmişte ara** alanına yazın.
MCP satırlarında araç, istem veya kaynak adı da aranır.

---

## Bir isteği yeniden oynatma

Bir geçmiş girdisine tıklayın. Girdi, özgün method, URL, header ve gövde dolu olarak
bir istek sekmesinde açılır ve kendi protokolünün editöründe görünür: HTTP, SOAP,
MCP, WebSocket, Socket.IO, GraphQL, gRPC ve SSE girdileri kendi editörlerinde yeniden
açılır.

Olduğu gibi gönderebilir ya da göndermeden önce herhangi bir alanı değiştirebilirsiniz.
Yeniden oynatma, elle kurulmuş bir istek gibi davranır — pre-request script'leri
çalışır, testler yürütülür ve sonuç yeni bir geçmiş girdisi olarak kaydedilir.

Runner ve test paketi sonuçları burada listelenmez. Onlar **Testler** sayfasında,
koşu geçmişinin altında durur; her koşu yeniden açılabilir ve HTML ya da JSON olarak
dışa aktarılabilir. Bkz. [Collection runner & otomasyon](/tr/docs/cli-and-automation).

---

## Girdileri kaldırma

- Bir satırdaki çöp kutusu düğmesi o girdiyi siler.
- Geçmiş kenar çubuğundaki **Temizle**, **yalnızca etkin projenin** geçmişini siler.
  Önce onay ister, kaç girdinin silineceğini söyler ve liste boşken devre dışıdır.
- **Ayarlar → Veri → Geçmişi temizle**, aynı işi Ayarlar penceresinden o proje için
  yapar.

Hiçbiri kayıtlı uç noktalarınızı, ortamlarınızı veya koleksiyon yapınızı etkilemez.
