---
title: Başlarken
description: Testnizer'ı yükleyin, ilk isteğinizi gönderin ve verilerinizin nerede saklandığını öğrenin.
order: 1
section: Başlarken
---

Bu beş dakikalık bir tur. Sonunda ilk HTTP isteğinizi göndermiş, yanıtın yerel olarak yakalandığını görmüş ve uygulamanın makinenizde her şeyi tam olarak nerede sakladığını öğrenmiş olacaksınız.

## Kurulum

Platform seçiminizi [İndirme sayfasından](/download) yapın. Yükleyiciler imzalıdır
(beta sürecinde macOS'ta ad-hoc — ilk açılışta sağ tık → Aç yapmanız gerekebilir).

Yükleyiciyi çalıştırmadan önce bütünlüğünü doğrulamak isterseniz, [Sürümleri doğrulama](/tr/docs/build-from-source) sayfasına bakın.

## İlk açılış

Testnizer, Hoş Geldiniz ekranıyla açılır. Hesap oluşturma yok, bulut girişi yok,
"senkronize etmek için oturum açın" istemi yok. (İsterseniz uygulamayı yerel bir
parolayla koruyabilirsiniz — parola scrypt ile hash'lenir ve makinenizden asla
çıkmaz.) Şunları yapabilirsiniz:

- **Yeni bir çalışma alanı oluştur** — çalışma alanları proje barındırır; projeler koleksiyon barındırır
- **Mevcut bir çalışma alanını aç** — diskteki bir klasörü işaret et
- **Atla ve varsayılan çalışma alanıyla başla**

Çalışma alanları klasörlerdir. Projenin tamamı diskinizdeki bir dizin ağacıdır —
taşıyın, sürümleyin, yedekleyin, paylaşın. Opak bir bulut veritabanı yoktur.

## İlk isteğinizi gönderin

1. Sol kenar çubuğunda **+ Yeni** üzerine tıklayın → **HTTP**
2. URL çubuğuna `https://httpbin.org/get` yapıştırın ve **GET** seçin
3. **Gönder**'e basın

Sağ bölmede yanıtı göreceksiniz: durum, başlıklar, JSON gövdesi. Alttaki
**Konsol** sekmesi ham istek ve yanıtı gösterir (bir zarf veya çok parçalı
yüklemeyi hata ayıklarken çok işe yarar).

## Verileriniz nerede?

Varsayılan olarak, Testnizer her şeyi işletim sisteminizin kullanıcı veri dizini
altındaki tek bir SQLite veritabanında tutar:

| Platform | Yol |
|---|---|
| macOS | `~/Library/Application Support/Testnizer/` |
| Windows | `%APPDATA%\Testnizer\` |
| Linux | `~/.config/Testnizer/` |

Bu klasörün içinde şunları bulacaksınız:

- `testnizer.db` — çalışma alanları, projeler, ortamlar, geçmiş, sertifikalar
- `secrets/` — token'lar ve parola ifadeleri için işletim sistemi anahtarlığıyla şifrelenmiş bloblar
- `settings.json` — arayüz tercihleri, klavye kısayolları, tema
- `backups/` — güncellemeden önce alınan veritabanı kopyaları (aşağıya bakın)

Veritabanı taşınabilirdir. `testnizer.db`'yi Testnizer çalışan başka bir makineye kopyalayın
ve koleksiyonlarınız da gelir. (Şifrelenmiş sırlar işletim sistemi anahtarlığına bağlıdır,
bu yüzden yeni bir makinede yeniden girilmeleri gerekir.)

### Güncellemeden sonra bir yedeği geri yükleme

Yeni bir sürüm ilk kez açıldığında Testnizer, veritabanını güncellemeden önce
`backups/testnizer.db.<sürüm>-<derleme>.<zaman damgası>` olarak kopyalar. En yeni 3 kopya
tutulur. Birine geri dönmek için:

1. Testnizer'dan çıkın. Sorun yeni sürümün kendisindeyse önce önceki sürümü kurun; daha
   yeni bir sürüm geri yüklenen kopyayı yeniden günceller.
2. Veri klasöründeki `testnizer.db`, `testnizer.db-wal` ve `testnizer.db-shm` dosyalarını
   (son ikisi olmayabilir) başka bir yere taşıyın. `-wal` / `-shm` dosyalarını geri yüklenen
   kopyanın yanında bırakmayın.
3. İstediğiniz yedeği veri klasörüne kopyalayıp adını `testnizer.db` yapın, ardından
   Testnizer'ı başlatın.

## Sıradaki adımlar

- [Postman / Insomnia / OpenAPI / cURL'den koleksiyon içe aktarın](/tr/docs/import-formats)
- [`{{değişken}}` ikamesiyle ortam ekleyin](/tr/docs/environments)
- [WSDL içe aktarmayla SOAP testi yapın](/tr/docs/protocols#soap)
- [WS-Security ile XML zarfı imzalayın](/tr/docs/ws-security)
