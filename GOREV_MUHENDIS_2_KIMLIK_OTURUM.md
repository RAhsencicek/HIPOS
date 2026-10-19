# Geçici iş paketi — Mühendis 2: Kimlik, oturum ve erişim sınırı

> **Belge yaşam döngüsü:** Bu dosya ilk geliştirme evresi için atanabilir görev brifidir; kalıcı ürün sözleşmesi değildir. Kabul koşulları tamamlanınca kararları ve kalıcı gereksinimleri ilgili ana belgelere aktarın, bu iş paketini devir rehberinden çıkarıp silin. Tamamlanmamış iş varsa silmeyin; durumunu ve sahibini güncelleyin.

## Görev amacı

Taklit edilebilir `X-Demo-Actor` kullanımından HIPOS hesabı, güvenli oturum, firma üyeliği ve sunucu tarafı firma/şube yetkisine geçiş için ilk güvenli, gerçek kullanıcıya uygun dilimi tasarlamak ve uygulamak. Garsonlara ayrı PIN eklemek gerekmiyor; cihazdaki açık HIPOS kullanıcı oturumu işlemlerin aktörü olmalıdır.

## Başlangıçta bilinmesi gereken mevcut durum

- Uygulanmış HIPOS giriş/çıkış, kullanıcı hesabı, üyelik veya oturum middleware'i yoktur.
- ASP.NET route'ları `X-Demo-Actor` başlığını Development/Production ayrımı olmadan okuyabilir; istemci bu başlığı taklit edebilir.
- Mevcut endpoint kapsam çözümü gerçek kimlik üyeliği değildir; production ortamında API'nin çalışması onu müşteri kullanımına hazır yapmaz.
- Ürün kararı: ilk pilot hesabını HIPOS ekibi kontrollü oluşturur; e-posta/şifre temel giriş yoludur; herkese açık kayıt ve dış sağlayıcıyla login ilk kapsamda değildir.
- İnternet kesintisinde yerel LAN API'si çalışmalı. Yerel auth doğrulaması, oturum süresi ve kullanıcı/rol iptalinin offline LAN'a yansıması açık karardır.

Kaynaklar: [Kimlik ve Hesap Akışı](KIMLIK_VE_HESAP_AKISI.md), [Çevrimdışı çalışma ve senkronizasyon](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md), [Devir rehberi](DEVIR_REHBERI.md), [bugünkü kod durumu](DURUM_VE_YOL_HARITASI.md).

## İlk evre kapsamı

### A. Mevcut erişim davranışını haritala

1. `DemoAccess`/`X-Demo-Actor` kullanımlarını, API endpoint gruplarını, denetim kayıtlarını ve CORS/istemci başlıklarını envanterle.
2. Firma/şube kontrolünün bugün hangi katmanda ve hangi test aktörleriyle yapıldığını belirt; gerçek üyelik doğrulaması varmış gibi yazma.
3. `401` kimlik doğrulama başarısızlığı ile `403` firma/şube/işlem yetki reddi ayrımını planla.
4. Oturumun online ve internet kesintisindeki davranışını mühendis 1 ve koordinatörlerle birlikte karara bağla.

### B. Kimlik ve aktör sözleşmesini onaylat

Uygulama öncesi kısa ADR/sözleşme ile şu seçimleri netleştir:

- Hesap, firma üyeliği, şube erişimi, rol ve aktiflik ilişkisi.
- Cookie tabanlı sunucu oturumu veya başka yöntem; CSRF ve güvenli cookie ayarları.
- Oturum yenileme/sona erme, çıkışta iptal ve parola saklama/sıfırlama yaklaşımı.
- Yerel API'nin internet olmadan geçerli oturumu doğrulama ve iptal/rol değişikliği sınırı.
- Denetim kaydındaki gerçek `userId` ve cihaz/istasyon bağlamı.
- Mühendis 1 POS operasyon akışının kullanacağı ortak `CurrentActor/SessionContext` ve firma/şube kapsam interface'i.

Kararları kalıcı [Kimlik ve Hesap Akışı](KIMLIK_VE_HESAP_AKISI.md) ve gerekiyorsa [offline sözleşmesine](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md) yaz. Token, cookie veya framework seçimini mevcut ASP.NET dağıtım ve LAN ihtiyaçlarına göre gerekçelendir.

### C. İlk uygulama dilimi

Koordinasyon onayı sonrası kapsamı küçük tut:

- Pilot hesapla giriş/çıkış ve doğrulanmış oturum bağlamı.
- Kullanıcının firma/şube üyeliğini sunucudan çözme; request path içindeki ID'leri yetki kanıtı saymama.
- En az bir temsilî okuma ve yazma endpoint'inde `401/403` ve tenant/branch izolasyonu.
- Denetim kaydını gerçek `userId` ile ilişkilendirme.
- `X-Demo-Actor` kullanımını üretim yolundan çıkarma; gerekiyorsa yalnız Development'da açık, açıkça sınırlı test adaptörü olarak koruma.
- Garson/kasa ekranlarının login state, oturum süresi doldu ve yetki yok durumlarını anlamlı göstermesi için Mühendis 1'e sözleşme sağlama.

E-posta daveti, herkese açık signup, Google/Microsoft login, MFA gibi kapsamları ürün kararı ve yayın kapısı olmadan bu ilk dilime ekleme.

### D. Teslim aşamaları ve üretim kapısı

1. **Önce ortak sözleşme:** Oturum biçimi, firma/şube üyeliği, `CurrentActor/SessionContext`, offline oturum doğrulama ve hata modeli Mühendis 1 ile karara bağlanır.
2. **İlk çalışan auth dilimi:** Kontrollü pilot hesabı giriş/çıkış yapar; yönetim paneli ve POS oturumu aynı API kimlik sözleşmesini kullanır; firma ve şube kapsamı sunucuda üyelikten çözülür; audit gerçek kullanıcıyı taşır.
3. **API koruma taraması:** Tenant verisi okuyan/yazan tüm route grupları kimlik ve firma/şube kontrolünden geçer. Tek bir örnek endpoint'in korunması auth işinin tamamlandığı anlamına gelmez. Mevcut route'ların her biri test matrisiyle listelenir; kapsam dışı bırakılan endpoint gerekçesi ve erişim kuralı yazılır.
4. **Offline LAN auth:** İnternet kesikken yerel API'nin oturumu hangi süre ve doğrulama kanıtıyla kabul edeceği, iptal/rol değişikliğinin sınırı ve yerel servis güveni offline sözleşmesine aktarılır. Bu davranış uygulanıp kabul edilmeden ürün offline yetkilendirmeyi hazır saymaz.

Kontrollü geliştirici ortamında tek endpoint'le ilk auth dikey dilimini göstermek ara kilometre taşı olabilir; fakat müşteri/pilot için tamamlanma ölçütü değildir.

## Bu görevde yapılmayacaklar

- POS/adisyon/ödeme state machine'ini değiştirmek.
- Mühendis 1'den bağımsız `CurrentActor` veya firma/şube context tanımı oluşturmak.
- Garsonlara ayrıca PIN zorunlu kılmak; ürün kararı cihazda açık HIPOS oturumudur.
- İnternet yokken kullanılacak oturum davranışını sessizce sonsuz geçerli kabul etmek.
- Müşteri ağına açılışı yalnız giriş ekranı eklendi diye güvenli ilan etmek.

## Kabul ölçütleri

- Login olmadan korumalı endpoint `401`; login olup kapsam dışı firmaya/şubeye erişim `403` döndürür.
- HIPOS giriş/çıkışı hem yönetim hem operasyon uygulama yüzlerinde çalışır; kullanıcı yeniden yükleme/yeniden açmada ürün kararına uygun biçimde oturumunu sürdürür veya sona erdiğini açık görür.
- Yetkili pilot kullanıcı kendi kapsamındaki endpoint'i kullanabilir; başka tenant/branch ID'si URL'ye yazmak erişim sağlamaz.
- Her yazma işleminin audit aktörü güvenilir oturumdan gelir; istemci header'ı ile seçilemez.
- `X-Demo-Actor` production isteklerinin aktörünü belirleyemez.
- API route envanterindeki tenant verisi taşıyan tüm endpoint'ler ya doğrulanmış oturum ve üyelikle korunur ya da açık, gerekçeli erişim politikasına sahiptir; sadece bir örnek route ile yetinilmez.
- Oturumun online, internet kesintisi/LAN ve expired/revoked durumları mühendis 1 ile ortak kararla belgelenmiş ve kabul senaryosuna çevrilmiştir.
- Mühendis 1'in POS/garson akışına bağlayacağı `CurrentActor/SessionContext` API'si ve hata modeli onaylanmıştır.
- Kalıcı kimlik belgesi, backend mimarisi ve mevcut durum envanteri uygulamayı doğru yansıtacak şekilde güncellenmiştir.

## Dosya sahipliği ve koordinasyon

Ana sahip: Mühendis 2. Ortak onay: koordinatör ve POS/LAN sahibi Mühendis 1. Auth/üyelik tablosu, middleware, oturum, CORS/CSRF ve `DemoAccess` geçişi bu görev alanıdır. `sales`/`service` domain iş kuralları ayrı tutulur; auth interface'ine uyması için gereken ortak değişiklikler önce Mühendis 1 ile paylaşılır.

PR açıklamasında korunan endpoint'ler, aktör/kapsam çözümü, `401/403` davranışı, migration/seed, audit ve offline auth kararı yazılır. İlk PR tercihen aktör/üyelik/oturum sözleşmesi olur.
