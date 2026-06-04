---
title: SSE ve AI Chat
description: Server-Sent Event akışlarını izleyin ve 14 AI sağlayıcısıyla sohbet edin — her ikisi de Testnizer'ın yerel SSE motoru tarafından desteklenir.
order: 7
section: Protokoller
---

Testnizer'ın SSE editörü ve AI Chat editörü, Node ana sürecinde çalışan aynı
`eventsource` tabanlı motoru paylaşır. Renderer, ayrıştırılmış olayları IPC
üzerinden alır ve kendisi hiçbir zaman açık bir soket tutmaz.

---

## Server-Sent Events

### SSE sekmesi açma

**+ Yeni** → **SSE** tıklayın. Editör, bir URL alanı, bir header tablosu ve boş
bir olay zaman çizelgesiyle açılır.

### URL ve header'lar

SSE uç nokta URL'sini girin. Değişkenler gerçek zamanlı olarak çözülür:

```
{{apiBaseUrl}}/events/stream?topic={{topicId}}
```

URL çubuğunun altındaki tabloya HTTP header'ları ekleyin. SSE uç noktaları için
yaygın header'lar:

- `Authorization: Bearer {{accessToken}}`
- `Accept: text/event-stream` (otomatik eklenir — yalnızca sunucu farklı bir
  değer gerektiriyorsa geçersiz kılın)
- `Cache-Control: no-cache` (otomatik eklenir)

### Bağlan ve Bağlantıyı kes

Bağlantıyı açmak için **Bağlan**'a tıklayın. Testnizer HTTP isteğini `Accept:
text/event-stream` ile gönderir ve soketi açık tutar. Durum göstergesi **Bağlanıyor**
→ **Açık** olarak değişir.

Bağlantıyı kapatmak için **Bağlantıyı kes**'e tıklayın. Zaman çizelgesi korunur,
böylece bağlantıyı kesmeden önce alınan olaylarda gezinebilirsiniz.

### Olay zaman çizelgesi

Her ayrıştırılmış olay geldiğinde zaman çizelgesinde görünür:

| Sütun | Açıklama |
|---|---|
| **Zaman** | Olayın alındığı zaman damgası (yerel saat) |
| **Olay** | `event:` alanının değeri veya belirtilmemişse `message` |
| **ID** | Varsa `id:` alanının değeri |
| **Veri** | `data:` yükü, ilk 256 karakterle kısaltılmış |

Sağdaki ayrıntı panelinde tam yükü genişletmek için herhangi bir satıra tıklayın.
JSON yükleri otomatik olarak güzel biçimlendirilir.

### SSE alan ayrıştırma

Testnizer dört standart SSE alanının tamamını ayrıştırır:

| Alan | Testnizer'ın yaptığı |
|---|---|
| `event:` | Olay türünü etiketler; olay türü filtresini yönetir |
| `data:` | Çok satırlı veri bloklarını biriktirir ve birlikte render eder |
| `id:` | Son olay ID'sini saklar; yeniden bağlanmada otomatik olarak gönderilir |
| `retry:` | Durum çubuğunda gösterilen yeniden bağlanma aralığını günceller |

Yorum satırları (`:` ile başlayan) atılmaz — zaman çizelgesinde soluk metinle
gösterilir; bu, sunucundan gelen canlı tutma yorumlarını hata ayıklamak için
kullanışlıdır.

### Last-Event-ID ve devam etme

Bağlantı kesildiğinde ve **Yeniden bağlan**'a tıkladığınızda Testnizer, `Last-Event-ID`
istek header'ını aldığı son `id:` değerine ayarlar. Uyumlu bir SSE sunucusu bunu,
kaçırılan olayları doğru konumdan tekrar oynatmak için kullanır.

Son bilinen ID, bağlantı panelinde gösterilir; yeniden bağlanmadan önce inceleyebilir
veya temizleyebilirsiniz.

### Olay türüne göre filtrele

Yalnızca belirli türdeki olayları göstermek için zaman çizelgesinin üzerindeki
**Filtre** alanını kullanın. `payment.confirmed` yazın; zaman çizelgesi diğer
tüm olay türlerini gerçek zamanlı olarak gizler. Filtre olayları düşürmez —
filtreyi temizlemek tam zaman çizelgesini geri yükler.

---

## AI Chat

### AI Chat sekmesi açma

**+ Yeni** → **AI Chat** tıklayın. Editör, bir sağlayıcı seçici, model seçici
ve sohbet arayüzüyle açılır.

### Desteklenen sağlayıcılar

| Sağlayıcı | Notlar |
|---|---|
| **OpenAI** | GPT-4o, o1, o3 ve diğer OpenAI modelleri |
| **Anthropic** | Claude 3.5, 3.7 ve güncel model serisi |
| **Google** | Gemini 1.5 / 2.0 ailesi |
| **xAI** | Grok modelleri |
| **DeepSeek** | DeepSeek-V3 ve akıl yürütme modelleri |
| **Mistral** | Mistral Large, Nemo, Codestral |
| **Groq** | Açık modeller için hızlı çıkarım barındırma |
| **Perplexity** | Sonar çevrimiçi modeller |
| **Cerebras** | Wafer ölçekli çıkarım |
| **Cohere** | Command R+ |
| **Fireworks** | Açık model barındırma (Llama, Mixtral vb.) |
| **DeepInfra** | Açık model barındırma |
| **Together** | Together AI açık model barındırma |
| **OpenRouter** | Birçok sağlayıcıya birleşik yönlendirici |

Açılır menüden bir sağlayıcı seçin. Testnizer, o sağlayıcı için model listesini
**Model** açılır menüsüne yükler.

### Özel URL (kendi barındırdığınız modeller)

Kendi barındırdığınız OpenAI uyumlu bir uç noktayı hedeflemek için sağlayıcı
açılır menüsünde **Özel URL**'yi seçin. Şunlarla çalışır:

- **vLLM** — `http://localhost:8000/v1`
- **LM Studio** — `http://localhost:1234/v1`
- **Ollama** — `http://localhost:11434/v1`
- **TGI (Text Generation Inference)** — `http://localhost:8080/v1`

Temel URL'yi girin. Özel URL kullanılırken model adı manuel olarak girilmelidir;
getirilecek uzak model listesi yoktur.

Yerel uç noktalar için API anahtarı gerekmez — anahtar alanını boş bırakın.

### Model parametreleri

| Parametre | Açıklama |
|---|---|
| **Model** | Model tanımlayıcısı (örn. `gpt-4o`, `claude-3-5-sonnet-20241022`) |
| **Temperature** | Örnekleme sıcaklığı — deterministik için 0,0, daha çeşitli çıktı için daha yüksek |
| **Max tokens** | Yanıttaki maksimum token sayısı |
| **Top-p** | Çekirdek örnekleme sınırı (özel bir nedeniniz yoksa 1,0'da bırakın) |

Parametreler sohbet sekmesi başına kaydedilir. Karşılaştırma için tek bir proje,
farklı sağlayıcı ve model yapılandırmalarıyla birden fazla AI Chat sekmesi içerebilir.

Her AI Chat sekmesi tamamen yalıtılmıştır — sağlayıcı, model, API anahtarı, sistem
prompt'u, konuşma geçmişi ve streaming durumu sekme başına ayrıdır. Farklı sağlayıcılarla
paralel konuşmalar yürütmek için birden fazla sekme açın; sekmeler arasında herhangi
bir durum sızıntısı yaşanmaz.

### Sistem prompt'u

Sohbetin üstündeki **Sistem** alanı serbest metin sistem prompt'u kabul eder.
Değişkenler burada çözülür:

```
Sen {{projectName}} için yardımcı bir asistansın.
Yalnızca {{productDomain}} hakkındaki soruları yanıtla.
```

Sistem prompt'u, konuşmanın kaç tur olduğundan bağımsız olarak her istekte
ilk mesaj olarak gönderilir.

### Çok turlu konuşma

Mesajlar konuşma penceresinde birikir. Her **Gönder** kullanıcı mesajını ve
modelin yanıtını geçmişe ekler. Tam geçmiş, modelin bağlama sahip olması için
sonraki her istekte dahil edilir.

**Geçmiş penceresi**: varsayılan olarak, mevcut sekmedeki tüm mesajlar dahil edilir.
Uzun konuşmalar için, eski mesajları kesmek ve modelin bağlam penceresinde kalmak
amacıyla sohbet ayarlarında bir **Geçmiş sınırı** (tur sayısı) belirleyin.

### API anahtarlarını güvenle saklama

API anahtarları asla doğrudan sohbet editörüne yapıştırılmamalıdır. Bunun yerine
ortam değişkenlerini kullanın:

1. Mevcut proje için **Ortamlar**'ı açın.
2. Bir değişken ekleyin: `apiKey` → `sk-...` (projeyle dışa aktarılmaması için
   ilk değer olarak değil **değer** olarak ayarlayın).
3. AI Chat editörünün **API Key** alanına `{{apiKey}}` girin.

Anahtar, makinenizdeki yerel SQLite veritabanında proje ortamı tarafından şifreli
olarak saklanır. Cihazı asla terk etmez.

```
API Key alanı:  {{openaiApiKey}}
                   ↓
          gönderim anında aktif ortamdan çözülür
          → ana süreç isteği gönderir
          → renderer yalnızca yanıt akışını görür
```

### Streaming ve streaming olmayan mod

Sohbet araç çubuğundaki **Streaming** geçişi yanıtların nasıl iletileceğini kontrol eder:

- **Kapalı** (varsayılan): Testnizer yanıtı render etmeden önce tam yanıtı bekler.
  Yanıtı bir test scriptinde post-işleme yapmanız gerektiğinde veya uç nokta
  streaming desteklemediğinde kullanışlıdır.
- **Açık**: Modelin yanıtı, API `text/event-stream` yanıtını akıtırken token token
  görünür. İlk tokena gecikme daha düşüktür. Bir streaming yanıt devam ederken
  araç çubuğunda bir **İptal** düğmesi görünür — tıklamak akışı hemen durdurur
  ve o ana kadar alınan metni korur.

### Konuşmayı kaydetme ve dışa aktarma

Mevcut konuşmayı proje geçmişine kaydetmek için sohbet araç çubuğundaki **Kaydet**
düğmesine tıklayın. Kaydedilen konuşmalar sol kenar çubuğundaki **Geçmiş** panelinde
AI Chat sekmesi altında görünür.

Dışa aktarma için:

- **JSON** — `[{role, content}, ...]` biçiminde ham mesajlar dizisi, tekrar
  oynatmak veya başka bir sisteme aktarmak için uygun
- **Markdown** — kullanıcı/asistan etiketleri ve zaman damgalarıyla okunabilir
  transkript

Dışa aktarmalar yerel kaydetme iletişim kutusu aracılığıyla diske yazılır —
renderer dışa aktarmayı IPC üzerinden başlatır ve ana süreç dosyayı yazar.
