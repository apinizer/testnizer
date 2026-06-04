---
title: İstek geçmişi
description: Testnizer'ın yerel geçmiş panelinden geçmiş isteklere göz atın, tekrar oynatın ve dışa aktarın.
order: 4
section: Referans
---

## Neler kaydedilir

Gönderdiğiniz her istek otomatik olarak kaydedilir. Bir oturumu kaydetmemeyi
tercih ederseniz **Ayarlar → Geçmiş → Kaydetme** bölümünden kaydetmeyi
devre dışı bırakın.

Her geçmiş girişi şunları yakalar:

- **Zaman damgası** — isteğin gönderildiği tam tarih ve saat.
- **Metod ve URL** — tüm ortam değişkenleri zaten çözülmüş olarak.
- **Durum kodu, yanıt süresi ve yanıt boyutu.**
- **İstek header'ları ve gövdesi** — ortam değişkenleriyle eşleşen gizli bilgiler
  depolanmadan önce maskelenir.
- **Yanıt header'ları ve gövdesi.**
- **Test assertion sonuçları** — hangi assertion'ların geçtiği ve hangilerinin başarısız olduğu.
- **Proje ve branch** — yalnızca URL'ye göre değil, bağlama göre geçmişi
  filtreleyebilmeniz için.

---

## Geçmişe göz atma

Sol kenar çubuğundaki **Geçmiş** sekmesini açın veya `Ctrl+H` (Windows/Linux)
/ `Cmd+H` (macOS) tuşlarına basın.

Liste en son giriş en üstte olacak şekilde sıralanır.

Filtreleme seçenekleri:

- **Ara** — URL parçasına veya durum koduna göre eşleştir.
- **Projeye göre filtrele** — yalnızca belirli bir proje içinde yapılan istekleri göster.
- **Tarih aralığına göre filtrele** — bir zaman penceresini daralt.

Sağ panelde tam istek ve yanıt ayrıntısını yüklemek için herhangi bir girişe tıklayın.

---

## Bir isteği tekrar oynatma

Bir geçmiş girişine tıklayın, ardından **Editörde aç**'a tıklayın. İstek editörü
orijinal metod, URL, header'lar ve gövde önceden doldurulmuş olarak açılır.

Olduğu gibi gönderebilir veya göndermeden önce herhangi bir alanı değiştirebilirsiniz.
Tekrar oynatma, manuel olarak oluşturulan bir istekle aynı şekilde davranır —
ön istek scriptleri çalışır, testler çalışır ve sonuç yeni bir geçmiş girişi
olarak kaydedilir.

**Koleksiyon çalıştırıcı sonuçları** da geçmişte görünür. Her çalıştırıcı
çalışması tek bir üst düzey giriş olarak saklanır. Çalıştırmanın parçası olan
her uç nokta için bireysel istek sonuçlarını görmek amacıyla genişletin.

---

## Geçmişi dışa aktarma

Bir veya birden fazla giriş seçin, ardından bağlam menüsünden **Dışa Aktar**'ı seçin.

Kullanılabilir biçimler:

| Biçim | Kullanım durumu |
|---|---|
| **HAR (HTTP Archive)** | Tarayıcı DevTools ve WebPageTest ile Charles Proxy gibi performans analizi araçlarıyla uyumlu. |
| **Testnizer JSON** | Girişleri başka bir Testnizer örneğine aktarın. Takım arkadaşlarıyla yeniden üretim durumlarını paylaşmak için kullanışlı. |
| **cURL komutları** | Uygulamayı açmadan istekleri tekrar oynatmak için doğrudan terminale yapıştırın. |

---

## Gizlilik ve saklama

Geçmiş, makinenizdeki yerel SQLite veritabanında (`data.db`) özel olarak saklanır.
Ağ üzerinden hiçbir şey iletilmez.

**Varsayılan saklama:** son 1.000 giriş. Eski girişler otomatik olarak silinir.

Saklama ayarını değiştirmek için **Ayarlar → Geçmiş → Saklama** bölümüne gidin.
Aralık 100 girişten sınırsıza kadardır.

**Sınırsız** seçeneğini belirlerseniz `data.db` zaman içinde büyür. Büyük yanıt
gövdeleri — ikili dosyalar, toplu veri dışa aktarmaları — gönderen projeler önemli
ölçüde büyük bir veritabanı üretebilir. Bu durum iş akışınız için geçerliyse
disk kullanımını izleyin.

**Manuel temizleme seçenekleri:**

- **Ayarlar → Geçmiş → Tümünü temizle** — tüm geçmiş günlüğünü siler.
- **Ayarlar → Geçmiş → Tarihten öncekileri sil** — belirttiğiniz tarihten eski
  girişleri kaldırır, yakın geçmişi korur.

Her iki eylem de kaydedilmiş uç noktalarınızı, ortamlarınızı veya koleksiyon
yapınızı etkilemez.
