---
title: JWK & JWKS
description: PEM'i JWK'ya ve geri çevirin, anahtar üretin, RFC 7638 parmak izlerini hesaplayın ve yerel mock sunucudan JWKS yayınlayın — çevrimdışı.
order: 3
section: Araçlar
---

**Tools → JWK**, JSON Web Key tezgâhıdır: dönüşüm, üretim, parmak izleri ve
gerçekten yayınlayabileceğiniz bir anahtar seti kurma.

## PEM ⇄ JWK

Bir PEM yapıştırın, JWK'yı alın; ya da bir JWK yapıştırın, PEM'i geri alın.
RSA ve EC anahtarları, public ya da private.

Bilinmesi gereken iki şey:

- **Private** JWK kartının kopyalama butonu, özel anahtar kopyaladığını söyler.
  Yanındaki buton yalnızca public yarısını kopyalar. Farklı etiketlenmeleri
  bilinçlidir — anahtar materyalinin yanındaki genel bir "Copy", özel anahtarın
  bir sohbet mesajında bulunma biçimidir.
- Dönüştürmek bir yargı değildir. Girdiyi değiştirirseniz önceki PEM
  temizlenir, yeni anahtarın yanında durmaz; böylece çoktan değiştirdiğiniz bir
  şeye ait sonucu okumazsınız.

## Üretme

Bir algoritma ve boyut seçin, doğrudan JWK olarak yeni bir anahtar alın — PEM'e
gidip gelmeden. `kid` sizin için üretilir, üzerine yazabilirsiniz.

## Parmak izleri

RFC 7638 parmak izleri kanonik üye kümesinden hesaplanır; yani değer, bir kimlik
sağlayıcının aynı anahtar için hesapladığıyla eşleşir. Bir token'ın üç
anahtardan hangisiyle imzalandığını çözmeye çalışırken işe yarar.

## Anahtar seti kurma

**Set** sekmesi anahtarları bir JWKS'te toplar. Aynı anahtarı iki kez eklemek
sessizce tekilleştirilmez, raporlanır — çünkü tek bir `kid` ile iki giriş,
şimdi görmek isteyeceğiniz gerçek bir yapılandırma hatasıdır.

## JWKS yayınlama

Bir anahtar seti, dahili **[mock sunucudan](/tr/docs/mock-server)** JWKS uç
noktası olarak yayınlanabilir. Bu, çevrimdışı bir kimlik testinin döngüsünü
kapatır:

1. JWK aracında bir anahtar çifti üretin.
2. Public anahtarı bir sete ekleyin ve `/.well-known/jwks.json` olarak yayınlayın.
3. Token'ı **[JWT / JOSE](/tr/docs/jwt-debugger)** aracında private yarısıyla
   imzalayın — ya da bir ön-istek betiğinden `pm.jose.sign` ile.
4. Yayınlanan JWKS URL'siyle doğrulayın.

Akışın tamamı `127.0.0.1` üzerinde koşar, yani internete çıkışı olmayan bir
makinede de çalışır.

## Bir token'ı JWKS ile doğrulamak

JWT aracının **JWKS** paneli bir URL'den anahtar seti çeker ve onunla doğrular.
İki davranış bilinçlidir:

- **Load, sonucunu Load'un yanında bildirir.** Çekme hatası, doğrulama
  sonucunda değil, çeken butonun yanında görünür. Hiç kontrol edilmemiş bir
  token için "geçersiz" demek sizi yanlış yere bakmaya gönderirdi.
- **Load ile verify arasında önbellek yok.** Bir kimlik sağlayıcı ikisi
  arasında anahtar döndürebilir; önbelleğe alınmış bir set o zaman sağlam bir
  token'ı imzası bozuk gibi gösterirdi.

## Anahtarlar nereye gider

Hiçbir yere. Dönüştürme, üretme ve parmak izi hesaplama uygulamanın süreci
içinde, Node'un kendi kripto modülüyle yapılır. JWK ekranlarının yaptığı tek
istek, sizin açıkça istediğiniz JWKS çekimidir — yazdığınız URL'ye.
