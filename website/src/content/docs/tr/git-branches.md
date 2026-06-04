---
title: Git entegrasyonu
description: Koleksiyonları özellik başına dallandırın, API değişikliklerini pull request'lerde inceleyin ve kimlik bilgilerini git geçmişinden uzak tutun.
order: 7
section: Kılavuzlar
---

## API koleksiyonları için neden git?

API koleksiyonları zamanla değişir — uç noktalar eklenir, parametreler kayar, auth
başlıkları güncellenir. Sürüm kontrolü olmadan bu değişiklikler, bir şey bozulana
kadar ekibin geri kalanı için görünmez olur.

Git, her değişikliğin yapılandırılmış bir geçmişini — kim yaptı ve neden bağlamıyla
birlikte — size sunar.

Koleksiyonlarınızı git'e bağlamak için pratik nedenler:

- **Ekip görünürlüğü.** Bir takım arkadaşı bir uç noktaya SOAP başlığı eklediğinde,
  değişikliği bir sonraki pull'da görürsünüz. Slack mesajına gerek yok.
- **PR tabanlı inceleme.** İnceleyenler hangi uç nokta parametrelerinin değiştiğini,
  yeni istek gövdesinin nasıl göründüğünü ve testlerin değişikliklerle birlikte
  güncellenip güncellenmediğini tam olarak görebilir.
- **Üretim öncesi test.** Deneysel koleksiyonları bir özellik dalında tutun.
  Değişiklikler doğrulandıktan sonra `main`'e birleştirin.
- **Uyumluluk ve denetim izi.** Her commit, kimin ne zaman ne değiştirdiğini
  kaydeder. Bu, düzenlenmiş ortamlarda — bankacılık, sigorta, kamu sektörü —
  önem taşır.

---

## Bir projeyi git deposuyla bağlama

1. Kenar çubuğunu açın ve proje adına tıklayın.
2. **Ayarlar → Git**'e gidin.
3. **Git deposuyla bağla**'ya tıklayın.
4. Yerel bir dizin seçin veya `git clone` URL'si yapıştırın.

Testnizer dahili olarak [`simple-git`](https://github.com/steveukx/git-js) npm
paketini kullanır. Tüm git işlemleri ana süreçte çalışır — bir terminale
düşürülmezsiniz.

Kutu dışı desteklenen uzak sunucular: GitHub, GitLab, Bitbucket, kendi barındırılan
Gitea ve HTTPS veya SSH üzerinden herhangi bir standart Git sunucusu.

---

## Proje başına dal

Her Testnizer projesi tek bir git dalına eşlenir. Bu, koleksiyon geçmişini temiz
tutar ve dal tabanlı iş akışlarını doğal kılar.

Bir ödeme API projesi için örnek kurulum:

| Dal | Amaç |
|---|---|
| `main` | Üretim koleksiyonu — kararlı, incelenmiş |
| `feature/payment-v2` | Yeni uç nokta deneyleri |
| `fix/auth-header` | İnceleme aşamasında auth başlığı düzeltmesi |

Dalları kenar çubuğundaki **dal seçiciden** değiştirin. Terminal gerekmez. Testnizer
seçilen dalı check out eder ve ilgili koleksiyon durumunu otomatik olarak yükler.

---

## Koleksiyon değişikliklerini taahhüt etme

Testnizer içinde yaptığınız değişiklikler — uç nokta ekleme veya kaldırma,
parametre güncelleme, istek gövdelerini düzenleme — otomatik olarak izlenir.

Kenar çubuğunun üstündeki **git rozeti** taahhüt edilmemiş değişikliklerin sayısını
gösterir. Kaydetmeye hazır olduğunuzda:

1. Rozete tıklayın veya **Git → Taahhüt et**'i açın.
2. Fark özetini inceleyin.
3. Bir taahhüt mesajı yazın (örneğin: `add invoice status endpoint`).
4. **Taahhüt et**'e tıklayın.

Taahhüt yerel depoda oluşturulur. Paylaşmaya hazır olduğunuzda aynı panelden
uzak sunucuya push edin.

---

## Pull request iş akışı

GitHub, GitLab veya Bitbucket'ta bir pull request açtığınızda, koleksiyon farkı
değişiklik setinin bir parçasıdır — depodaki diğer herhangi bir dosya gibi.

İnceleyenler şunları görebilir:

- Hangi uç noktaların eklendiğini, değiştirildiğini veya kaldırıldığını.
- JSON istek gövdesinin revizyonlar arasında nasıl değiştiğini.
- Hangi yeni başlıklar veya sorgu parametrelerinin tanıtıldığını.
- Ön istek betiklerinin veya test onaylarının güncellenip güncellenmediğini.

Bu, API değişikliklerini yalnızca birisinin yerel Testnizer örneğinde yaşayan bir
şey değil, kod incelemesinin birinci sınıf bir parçası haline getirir.

---

## Sırları git'ten uzak tutma

Kimlik bilgileri — API token'ları, parolalar, istemci sırrları — koleksiyonun
kendisinde değil **ortam değişkenleri** olarak saklanır. Testnizer, `{{MY_TOKEN}}`'ı
aktif ortamı kullanarak istek zamanında çözümler.

Yine de, hassas dosyaların git'ten tamamen dışlanmasını sağlamak önemlidir.
Projenizin `.gitignore`'una aşağıdakini ekleyin:

```gitignore
# Testnizer — kullanıcı verilerini veya sırları taahhüt etme
data.db
secrets/
*.db-wal
*.db-shm
settings.json
```

`data.db`, ortam değerlerinizi, geçmişinizi ve önbelleğe alınmış yanıtlarınızı
depolayan yerel SQLite veritabanıdır. Hiçbir zaman taahhüt edilmemelidir.

Yalnızca koleksiyon tanım dosyaları — uç noktalar, şemalar, bileşenler — git'e
aittir.

---

## Birleştirme çakışmaları

İki takım üyesi farklı dallarda aynı uç noktayı düzenlerse, bu dallar
birleştirildiğinde birleştirme çakışması meydana gelir.

Testnizer çakışmayı Workbench içinde bir **JSON farkı** olarak sunar. Her iki
sürümü yan yana görebilir, hangi değişikliklerin korunacağını seçebilir ve sonucu
doğrudan düzenleyebilirsiniz. Çözümlendikten sonra Testnizer birleştirilmiş durumu
kaydeder ve çakışmayı git'te çözümlendi olarak işaretler.

Çakışmaları ele almak için uygulamayı terk etmeniz gerekmez.
