---
title: AI Chat
description: 14 LLM sağlayıcısı veya OpenAI uyumlu herhangi bir uç nokta ile sohbet edin, modelin MCP araçlarını onayınızla çağırmasına izin verin, her yanıt için süre ve token kullanımını görün ve AI mock sunucusuyla token harcamadan test edin.
order: 11
section: Protokoller
---

AI Chat editörü, dil modelleri için akışlı (streaming) bir sohbet istemcisidir.
Bir sağlayıcı, bir model ve bir uç nokta seçer, bir istem yazarsınız; yanıt
üretildikçe görünür. Bir uç noktayı, bir ağ geçidini ya da bir modeli bir API'yi
dener gibi denemek için tasarlanmıştır: her yanıt için durumu, ilk token'a kadar
geçen süreyi, süreyi ve token kullanımını görürsünüz.

İstek, OpenAI uyumlu ve Anthropic API'leri için kendi akış motorunu kullanan
Node ana sürecinden çıkar. Renderer akışı yalnızca IPC üzerinden alır.

## AI Chat sekmesi açma

**+ Yeni** → **AI Chat** tıklayın. Editörde açılıp kapanan bir **Ayarlar** bölümü,
açılıp kapanan bir **Araçlar** bölümü, konuşma ve bir istem kutusu bulunur.
Göndermek için Enter, yeni satır için Shift+Enter kullanın. Her sekme bağımsızdır:
sağlayıcı, model, anahtar, sistem yönergesi ve konuşma sekmeye özeldir; iki
sağlayıcıyı yan yana çalıştırabilirsiniz.

## Sağlayıcılar

**Sağlayıcı** listesinde 14 adlandırılmış sağlayıcı ve **Custom** vardır:

| Sağlayıcı | API biçimi |
|---|---|
| OpenAI, Google, xAI, DeepSeek, Mistral, Groq, Perplexity, Cerebras, Cohere, Fireworks, DeepInfra, Together, OpenRouter | OpenAI uyumlu chat completions |
| Anthropic | Anthropic Messages API |
| Custom | Verdiğiniz URL'de OpenAI uyumlu chat completions |

Bir sağlayıcı seçmek **Uç nokta URL'si**ni o sağlayıcının varsayılan sohbet uç
noktasıyla doldurur ve **Model** alanında birkaç model kimliği önerir. Model alanı
serbest metindir: hesabınızın kullanabildiği herhangi bir model kimliğini yazın.
Uç nokta her zaman düzenlenebilir ve **Varsayılana sıfırla** sağlayıcının kendi
URL'sini geri getirir; adlandırılmış bir sağlayıcıyı bir ağ geçidine ya da proxy'ye
böyle yönlendirirsiniz.

### Custom ve kendi barındırdığınız uç noktalar

**Custom** seçin ve **tam chat-completions URL'sini** girin; örneğin Ollama için
`http://localhost:11434/v1/chat/completions` ya da LM Studio için
`http://localhost:1234/v1/chat/completions`. Testnizer tam olarak girdiğiniz
URL'ye POST eder. Model adını elle yazın. Anahtar gerektirmeyen yerel bir sunucu
için API anahtarını boş bırakın; o zaman `Authorization` başlığı gönderilmez.

## Ayarlar

| Alan | Ne yapar |
|---|---|
| **Sağlayıcı**, **Model**, **Uç nokta URL'si** | Yukarıdaki gibi. URL'de `{{değişkenler}}` çalışır. |
| **API Anahtarı** | `Authorization: Bearer …` (OpenAI uyumlu) ya da `x-api-key` (Anthropic) olarak gider. `{{değişken}}` desteklenir. |
| **Sistem yönergesi** | Her istekle gönderilir. `{{değişkenler}}` desteklenir. |
| **Sıcaklık (temperature)** | 0 ile 2 arası. Boş bırakılırsa sağlayıcının varsayılanı kullanılır. |
| **Maksimum token** | Boş bırakılırsa sağlayıcının varsayılanı kullanılır; Anthropic bir değer ister, bu yüzden alan boşsa Testnizer 4096 gönderir. |
| **Özel Başlıklar** | Her isteğe eklenen başlıklar. `Authorization` adlı bir başlık üretilen başlığın yerine geçer; bu yüzden kimlik doğrulamayı burada verirseniz API anahtarı isteğe bağlıdır. |

Bir yanıt token sınırına ulaşıldığı için durduğunda yanıt **Yanıt kesildi:
maksimum token sınırına ulaşıldı** diye işaretlenir.

Ctrl+S AI Chat yapılandırmasını (sağlayıcı, uç nokta, model, sistem yönergesi,
başlıklar, sıcaklık, maksimum token ve araç sunucuları) istekle birlikte kaydeder
ve isteği yeniden açtığınızda geri yükler. Akış her zaman açıktır: yanıtlar
üretildikçe gelir ve **Durdur** düğmesi bir yanıtı erken bitirir, o ana kadar
alınan metni korur.

### API anahtarınız nerede durur

Anahtar **işletim sisteminizin anahtar deposuyla şifrelenerek, her sağlayıcı için
bir anahtar** olarak saklanır (Custom için her sunucu adresi başına bir anahtar;
iki ağ geçidi bir anahtarı paylaşmaz). İstekle birlikte kaydedilmez, proje
dosyasına ya da Git'e yazılmaz ve uygulamanın tarayıcı depolamasında tutulmaz.
Bir anahtarı bir kez yazın; o sağlayıcıyı kullanan her AI Chat sekmesi onu
kullanabilir. Sistemde anahtar deposu yoksa (bazı Linux kurulumları) anahtar
yalnızca bellekte tutulur, bir not bunu söyler ve yeniden başlatmadan sonra tekrar
girersiniz.

Başlıklar farklı çalışır: düz değer olarak yazılmış bir kimlik bilgisi başlığı
(`Authorization`, `*-Key`, `*-Token`) oturum boyunca kullanılır ama kaydedilmez.
Saklamak için bir `{{değişken}}`, tercihen gizli (secret) bir değişken kullanın.

## Araçlar: modelin MCP sunucularını çağırması

Modele MCP araçları vermek için **Araçlar**'ı açın. Her girdi bir MCP sunucusudur:

- **Kayıtlı bir MCP isteği ekle…** projedeki kayıtlı MCP isteklerinden birini ekler.
- **Sunucu ekle** URL ile (Streamable HTTP veya SSE) ya da stdio komut satırıyla,
  başlıklar veya ortam değişkenleriyle geçici bir sunucu ekler.

Her sunucunun bir **Bu sunucuyu kullan** anahtarı vardır; **Araçları yükle**
araçlarını listeler, her aracın kendi onay kutusu vardır, böylece modelin hangi
araçları görebileceğine siz karar verirsiniz. Model yanıt verirken bunları çağırmayı
isteyebilir; sonuç modele geri gider ve model devam eder. Tek bir istem en fazla 10
model çağrısı yapar; sonra yanıt bir bildirimle durur ve devam etmek için yeni bir
mesaj gönderebilirsiniz.

### Önce onay

![Model bir MCP sunucusundaki echo aracını çalıştırmadan önce onay isteyen AI Chat](/docs/screenshots/ai-chat-tool-approval.png)

Her araç çağrısı önce size sorar. Kart sunucuyu, aracı ve argümanları gösterir; üç
seçenek vardır:

- **Bir kez izin ver**
- **Bu konuşma boyunca bu araca izin ver**
- **Reddet**

Argümanları 32.000 karakteri aşan bir araç çağrısı çalıştırılmaz, çünkü kart neyi
onayladığınızı size gösteremezdi.

**Araçları sormadan çalıştır** soruları yalnızca açık sekme için kapatır.
Hiçbir zaman kaydedilmez, tarayıcı depolamasına bile yazılmaz; yeni bir sekmede ya
da yeniden başlatmadan sonra yine kapalıdır. Araç çıktısı güvenilmez metindir ve
modeli yönlendirebilir; onayın varsayılan olmasının nedeni budur.

### stdio sunucuları güveninizi ister

stdio MCP sunucusu, bilgisayarınızda çalışan bir komuttur. AI Chat bir tanesini
başlatmadan önce **Bu stdio MCP sunucusuna bu bilgisayarda güvenilmiyor** kartı
komut satırını ve çalışacağı ortam değişkenlerini gösterir. Kimlik bilgisi adı
taşıyan değişkenlerin değerleri gizlenir; çalışan programı değiştirebilen
değişkenler (`NODE_OPTIONS`, `LD_*` ya da `PATH` gibi) **Çalışan programı
değiştirebilir** diye işaretlenir. **Güven ve bağlan** ya da **Bu sunucuyu atla**
seçin. Güven yalnızca o komut ve ortam için, yalnızca bu bilgisayarda geçerlidir.
Aynı kural Runner, Test Paketleri ve Zamanlayıcı için de geçerlidir; bkz.
[MCP](/tr/docs/protocols/mcp).

Geçici bir sunucunun URL'sine, komut satırına ya da ortamına düz yazılmış bir
kimlik bilgisi oturum boyunca kullanılır ve istekle birlikte kaydedilmez.

## Bir yanıtı okuma

![Araç çağrısından sonra gelen AI Chat yanıtı: durum, ilk bayta kadar süre, toplam süre, token ve model çağrısı sayısı](/docs/screenshots/ai-chat-reply.png)

Her yanıtın altında bir ölçüm satırı görürsünüz:

- çağrının **HTTP durumu**, başarılıysa yeşil;
- **İlk token**: ilk akan token'a kadar geçen süre;
- **Toplam**: model çağrılarının süresi (onayınızı ya da bir aracı beklemek
  sayılmaz);
- **token sayısı**; girdi, çıktı, önbellekten ve akıl yürütme token'ları üzerine
  gelince görünür. Bir sağlayıcı kullanımı bildirmezse satırda **token:
  bildirilmedi** yazar; asla 0 göstermez. Bir turdaki çağrıların yalnızca bir kısmı
  kullanım bildirdiyse toplam **kısmi** diye işaretlenir;
- bir tur birden fazla model çağrısı yaptıysa çağrı sayısı ve saat.

Token kullanımı, seçeneği belgeleyen sağlayıcılardan istenir; diğerlerinde yalnızca
sağlayıcı kendiliğinden gönderirse görünür.

### Sağlayıcı yanıt ortasında hata verirse

Sağlayıcı yanıt vermeye başladıktan sonra bir hata gönderirse (örneğin akışın
ortasında aşırı yük hatası), eksik metin konuşmada kalır ve hata onun altında
görünür. İstek kabul edildiği için durum rozeti turuncuya döner ve örneğin
**200 · yarıda kesildi** yazar.

## Konuşmalar

Konuşma, bir AI Chat isteğinin mesaj listesidir. Editörün üstündeki konuşma
çubuğuyla **Yeni konuşma** başlatabilir, kayıtlı konuşmalar arasında geçiş
yapabilir, yeniden adlandırabilir ve silebilirsiniz. **Temizle** geçerli konuşmayı
boşaltır.

Konuşmalar **yalnızca bu bilgisayarda**, yerel veritabanında saklanır. Hiçbir
zaman dışa aktarılmaz, Git commit'ine girmez ve proje dışa aktarmasına
kopyalanmaz. Yazılırken maskelenirler; yani kimlik bilgileri ve gizli
değişkenlerin değerleri saklanan metne girmez. Her konuşma 2 MB ile sınırlıdır
(önce en eski araç sonuçları kısaltılır). Bir isteği, klasörü ya da projeyi
silmek konuşmalarını da siler.

İstemlerinizde değişkenler çözülür: bir ortam değerini yerine koymak için
`{{değişken}}` yazın.

## Token harcamadan deneme

Mocks panelinde OpenAI sohbet API'si ve Anthropic mesajlar API'si gibi yanıt veren,
akışlı yanıt, token kullanımı, araç çağrıları ve bilerek hatalar (429, 500, 401,
akış ortası hatalar) sunan bir **AI** mock sunucusu vardır. **Başlat ve AI Chat
sekmesinde aç** bu editörü mock'a yönlendirilmiş olarak açar: Custom sağlayıcıyla,
Anthropic uç noktası için Anthropic sağlayıcısıyla.

Bir mock'tan açılan sohbet sekmesi kayıtlı sağlayıcı anahtarınızı mock'a
**asla göndermez**. Anahtar alanı bunu söyler; o sekmede yazdığınız anahtar yalnızca
orada kullanılır ve **Kayıtlı anahtarı kullan** kayıtlı olanı isterseniz geri
getirir. Bkz. [AI (LLM) mock sunucusu](/tr/docs/mock-server/ai).
