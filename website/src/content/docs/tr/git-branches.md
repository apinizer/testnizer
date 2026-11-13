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

Mevcut bir depodan başlamak için proje oluştururken **Clone from Git**'i seçin ve depo URL'sini,
dalı, kullanıcı adını, kişisel erişim token'ını (şifreli saklanır) ve yerel bir dizini girin. Bu
şekilde dışarıdan gelen bir proje, bu bilgisayarda izin verene kadar hiçbir script çalıştırmaz;
bkz. [Betikler](/tr/docs/scripts#betik-çalışma-zamanı).

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

## Dal menüsü: commit, çekme, gönderme, birleştirme

Dal seçici; **Commit et…**, **Çek**, **Gönder**, **Birleştir** ve **Tüm değişiklikleri at**
seçeneklerini içeren bir menü açar ve dalınızın uzak depoya göre kaç commit **geride** ve
**ileride** olduğunu (son fetch itibarıyla) gösterir. Henüz uzak depoda olmayan dal bunu söyler.

### Commit

**Commit et…**, **Değişiklikleri commit et** panelini açar. Son commit'ten bu yana değişen
her şeyi türe göre gruplayarak (klasörler, uç noktalar, kayıtlı istekler, örnekler,
ortamlar, test süitleri, mock sunucular, sertifikalar vb.) ve her birini **Eklendi**,
**Değiştirildi** ya da **Silindi** olarak işaretleyerek listeler.

1. Bir değişikliği bu commit dışında bırakmak için işaretini kaldırın; kalanlar projenizde
   commit edilmemiş değişiklik olarak durur (dal değiştirmek ya da birleştirmek onları otomatik
   commit eder; Gönder önce sorar). Başka bir değişikliğe ihtiyaç duyan değişiklik (yeni
   klasördeki bir istek) onu da birlikte seçer; böylece bir commit eksik bir şeye işaret
   etmez. Panel hangilerinin birlikte commit edildiğini söyler.
2. Bir commit mesajı yazın.
3. **Commit et** (yalnızca yerel) ya da **Commit et ve gönder**'i seçin.

Uzak depo yalnızca gönderdiğinizde güncellenir. **Tüm değişiklikleri at**, kaç değişikliğin
kaybolacağını onayladıktan sonra projeyi son commit'e döndürür; bu geri alınamaz. Devam eden
bir birleştirme varken panel, önce dal menüsünden çözmenizi ya da iptal etmenizi ister.

### Gönderme ve çekme

**Gönder** önce bir commit mesajı sorar ve kaç commit edilmemiş değişikliği içereceğini
söyler. Yalnızca mevcut commit'leri gönderip commit edilmemiş değişiklikleri olduğu yerde
bırakabilirsiniz. Sunucunun kısa süreliğine 5xx hatasıyla reddettiği bir push otomatik
yeniden denenir; yine de başarısız olursa mesaj hiçbir şeyin kaybolmadığını söyler ve tekrar
göndermek ikinci bir commit oluşturmaz.

**Çek** yalnızca istekleri değil **tüm projeyi** getirir: proje düzeyindeki yetkilendirme,
ön istek ve test scriptleri, zaman aşımı, SSL, yönlendirme ve TLS ayarları da onunla
gelir; böylece projenin auth'unu devralan istekler takım arkadaşınızın makinesinde de
çalışır. Bir çekme, bu bilgisayarda kaç sır değerinin hâlâ boş olduğunu söyler.

Git hata mesajları arayüz diline uyar.

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

Sır değerleri makinenizde kalır. **Sır** işaretli değişkenler, mock sunucu kimlik doğrulaması,
bir Mock MCP bearer token'ı, sertifika parolaları ve projenin Auth ayarlarındaki düz metin
kimlik bilgileri, Git'e giden her dosyada (commit, push, proje dosyası) **boş değer** olarak
yazılır ve bir çekme yerel değerinizin üzerine yazmaz. Yalnızca `{{değişken}}` başvuruları
taşınır. Dosyaları ya da parolası çekilen bilgisayarda bulunmayan bir sertifika **devre dışı**
gelir; böylece yüklenemeyen bir sertifika o host'a giden her isteği bozmaz. Eski bir Testnizer
sırları bir depoya zaten gönderdiyse bunlar geçmişte kalır: döndürün (rotate edin).

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

Proje dosyasında bir birleştirme ya da çekme çakışırsa Testnizer önce satır satır birleştirir:
iki tarafın eklemeleri korunur, yalnızca bir tarafın değiştirdiği satır o değişikliği alır,
iki tarafın da değiştirdiği satır daha yeni olanı alır, bir tarafın sildiği ve diğerinin
değiştirdiği satırda değişiklik korunur. Ardından birleştirmeyi commit eder. Bu şekilde
birleştiremediği bir dosya için, o dosyada **Mine** (bu dal) ya da **Theirs** (uzak) seçtiğiniz
bir diyalog açılır; birleştirmeyi iptal de edebilirsiniz.

Çakışmaları ele almak için uygulamayı terk etmeniz gerekmez.
