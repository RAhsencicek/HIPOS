# Geçici iş paketi — Mühendis 1: Kasa ekranı, POS/servis ve LAN çalışma temeli

> **Belge yaşam döngüsü:** Bu dosya ilk geliştirme evresi için atanabilir görev brifidir; kalıcı ürün sözleşmesi değildir. Kabul koşulları tamamlanınca kararları ve kalıcı gereksinimleri ilgili ana belgelere aktarın, bu iş paketini devir rehberinden çıkarıp silin. Tamamlanmamış iş varsa silmeyin; durumunu ve sahibini güncelleyin.

## Görev amacı

Yönetici paneliyle aynı HIPOS verisi ve kuralları kullanan gerçek restoran kasa ekranını tasarlamak; garson, adisyon ve mutfak akışlarıyla bir araya getirmek; ilk POS/servis dilimini planlayıp ortak LAN çalışma temelini mühendis 2'nin kimlik/oturum çözümüyle çakışmadan hazırlamak. Kasa ekranı Mühendis 1'in açık sahipliğindedir. Bu görev tek başına gerçek ödeme, ÖKC entegrasyonu veya tam çevrimdışı eşitleme tamamlandı demek değildir.

## Başlangıçta bilinmesi gereken mevcut durum

- `apps/pos` altında `/waiter` ve `/kitchen` vardır; garson siparişi API'ye yazar, mutfak ekranı siparişleri periyodik alır. Bunlar geliştirme/test akışlarıdır.
- `sales.checks` ortak adisyonu açma, sipariş ekleme, liste/detay ve simüle ödeme API'si sunar. Garson masa siparişi check'e bağlanır.
- Adisyon kapama/taşıma/birleştirme, tam sipariş durumu makinesi, gerçek tahsilat, mali fiş/ÖKC, mutfak yazıcı sürücüsü ve gerçek oturum yoktur.
- Bir yerel restoran sunucusu, internet kesintisinde LAN ortak çalışması, outbox ve merkezi eşitleme uygulanmış değildir.
- `X-Demo-Actor` gerçek kullanıcı değildir. Mühendis 2'nin sağlayacağı aktör/oturum sözleşmesi olmadan auth veya aktör modelini burada yeniden tanımlamayın.

Kaynaklar: [Kasa/POS operasyon sözleşmesi](KASA_POS_VE_OPERASYON_SOZLESMESI.md), [Ortak Adisyon sözleşmesi](ORTAK_ADISYON_SOZLESMESI.md), [Çevrimdışı çalışma ve senkronizasyon sözleşmesi](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md), [bugünkü kod durumu](DURUM_VE_YOL_HARITASI.md).

## İlk evre kapsamı

### A. Kod ve senaryo keşfi

1. Garson → API → adisyon → mutfak ekranı akışını mevcut kaynak kod ve DTO'larla eşleştir.
2. Aynı şubede birden çok cihazın kullandığı veri ve eksik domain geçişlerini (sipariş gönderme, iptal/değişiklik, mutfak kabul/hazır, check kapama) listele.
3. Varsa çalışan local demo ile gerçek LAN/offline sunucu gereksinimini ayrı göster; mevcut demo davranışını üretim hazır sayma.
4. Koddata, yazıcı ve ÖKC modelini varsayma. Donanım/SDK/OS bilgisi doğrulanmadıysa adapter sınırı ve soru listesi oluştur.

### B. Kasa ekranı tasarımı ve yönetici paneli uyumu

1. Yeni nesil dokunmatik kasa ekranının bilgi mimarisini ve ana kullanıcı akışlarını tasarla: hızlı satış, ürün/kategori/arama, sepet, barkod okuyucu girişi, masa seçme, açık adisyon bulma/açma, sipariş gönderme, ödeme yöntemi/sonucu, fiş durumu ve iptal/iade yetkileri.
2. Garsonun mobil ekranı, kasiyerin dokunmatik ekranı ve mutfak ekranının aynı sipariş/adisyonu farklı görev odaklarıyla göstermesini sağla. Kasa ekranını yönetici paneline gömülü bir yönetim sayfası gibi değil, aynı ürün/veri kurallarına bağlı bir operasyon yüzü olarak tasarla.
3. Yönetici panelindeki katalog, yayınlanmış ürün/fiyat, şube, masa, personel/garson ve özellik ayarlarının kasada hangi kaynağa ve API'ye bağlanacağını eşleştir. Mock/örnek veri ile işletme kaydını görsel ve akış olarak ayır.
4. Panel ve kasa arasında ortak olan UI shell, tasarım tokenları, form bileşenleri veya oturum/context kodunu belirle; ekranların iş akışı farklılığını korurken ortak davranışları yeniden kullan.
5. `apps/pos` içinde kasa rotası mı, ayrı `apps/cashier` yüzü mü olacağına ekran akışları, mobil/touch uyumu, PWA/kurulum, ortak component ve dağıtım gerekçeleriyle ADR hazırla.
6. İnternet/LAN/sync durumunu ve kaydedildi/gönderiliyor/hata/belirsiz durumlarını kasa ekranının akışına yerleştir; yerel kaydı merkezi eşitlenmiş gibi gösterme.

### C. Ortak kararlar ve API sözleşmesi

Kod değişikliğinden önce koordinatör ve mühendis 2 ile aşağıdakileri karara bağla veya açık ADR olarak bırak:

- İstemcilerin kararlı API adresi: her zaman yerel servis mi, online'da bulut mu; LAN servis keşfi nasıl yapılacak?
- Restoran başına local API/DB kurulum biçimi ve yerel yazma otoritesi.
- Online/yerel iş komutlarının tek domain sözleşmesini nasıl paylaşacağı.
- `CurrentActor/SessionContext`, firma/şube, cihaz/istasyon alanlarının ortak API'ye nasıl taşınacağı.
- LAN yokken cihaz içi işlem kuyruğu ilk sürümde desteklenecek mi? Onay olmadan destek sözü verme.
- Sipariş/adisyon komutlarında idempotency, sürüm çakışması, `unknown` ödeme ve audit yaklaşımı.

Sonuçları ana [POS](KASA_POS_VE_OPERASYON_SOZLESMESI.md) ve [offline](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md) sözleşmelerine yaz; yalnız göreve özgü geçici TODO'lar bu dosyada kalsın.

### D. Teslim aşamaları

1. **Önce tasarım ve ADR:** Kasa ekranı akışını, yönetici paneli veri eşlemesini ve uygulama yüzü kararını koordinatör onayına getir. Bu onay olmadan yeni paralel katalog/adisyon modeli kurma.
2. **İlk çalışan kasa dilimi:** Kasa için ayrı, dokunmatik uyumlu bir operasyon ekranı/rotası oluştur. Yayınlanmış katalog ve fiyatı seçili şube bağlamıyla oku; ürünleri sepete ekle; mevcut desteklenen API üzerinden kalıcı sipariş/adisyon oluştur; sonucu yönetim satış/adisyon görünümünde, garson ve mutfak akışlarında aynı kayıt olarak göster. Ödeme yalnız simülatörse bunu açıkça etiketle.
3. **LAN ve eşitleme devamı:** Yerel sunucu, merkez sync ve offline outbox'ı yalnız ADR ile kesinleşen topolojiye göre aşamalı uygula. Bu altyapı tamamlanana kadar ilk dilim LAN ortak çalışma veya merkezi sync tamamlandı diye duyurulamaz.

Bu nedenle wireframe tek başına ilk evre uygulama kabulü değildir. Wireframe/akış onayı tasarım kapısıdır; ilk evrenin ürün teslimi çalışan kasa akışı ve kalıcı ortak veri dilimidir.

### E. İlk uygulama dilimi

Koordinasyon onayı sonrası bir dar dikey dilim seç: garsondan oluşturulan siparişin kalıcı adisyona bağlanması ve aynı LAN'daki mutfak/kasa ekranında doğru durumla görülmesi. Gerekirse yeni kasa ekranı `apps/pos` içine mi yoksa `apps/cashier` olarak mı konacak kararını ADR ile kaydet.

Bu dilimde:

- Tek API/domain komutları ve aynı kimlikler kullanılır; ekranlar ayrı sipariş gerçeği yaratmaz.
- Kasa ekranı yönetici panelindeki aktif firma/şube, yayınlanmış katalog/fiyat ve servis yapılandırmasıyla aynı HIPOS kaynaklarına bağlanır; ayrı ürün/fiyat/masa listesi kopyası oluşturmaz.
- Dokunmatik öncelikli kasa akışı, hızlı satış ve masa/adisyon akışını anlaşılır biçimde ayırır; garson/mutfak görev akışlarıyla aynı adisyon ve sipariş durumlarını gösterir.
- Tekrar istek çift sipariş/çift mutfak bileti üretmez.
- UI kaydedildi, gönderiliyor, hata ve yerel/merkezi sync durumlarını birbirinden ayırır.
- Yazıcı entegrasyonu yoksa tarayıcı yazdırma penceresini gerçek otomatik yazıcı gibi sunmaz.
- Auth API'sine mühendis 2'nin onayladığı interface üzerinden bağlanılır; geçici aktör başlığı yeni ürün akışına taşınmaz.

## Bu görevde yapılmayacaklar

- HIPOS kullanıcı/oturum/üyelik sistemini ayrı modellemek.
- Yönetici panelinin mevcut navigasyonunu kasa işlemleriyle doldurup iki yüzün kullanıcı görevlerini birbirine karıştırmak.
- Gerçek banka/kart/yemek kartı tahsilatı veya mali ÖKC fişi iddiası.
- Sağlayıcı SDK'sı ve cihaz modeli doğrulanmadan Beko/Koddata uyumluluğu ilan etmek.
- Merkezi sync kararları ve yerel sunucu dağıtımı karara bağlanmadan tam offline altyapı yazmak.
- Mühendis 2'nin alanındaki auth veya firma/şube yetki kontrolünü gevşetmek.

## Kabul ölçütleri

- Mevcut akışın gerçek ve eksik parçaları kaynak kodla doğrulanmış kısa envanter olarak kayıtlıdır.
- Kasa ekranı uygulaması ve onaylı kullanıcı akışı; hızlı satış, masa/adisyon, sepet, ödeme sonucu ve hata/bağlantı durumlarını kapsar. Wireframe tasarım onayıdır, tek başına tamamlanma değildir.
- En az hızlı satışta ürün seçme → sepet → kalıcı sipariş/adisyon oluşturma → mevcut yönetim/garson/mutfak yüzlerinde aynı kaydı görme akışı çalışır. Henüz API'si olmayan kapama/taşıma/iade ve gerçek ödeme tamamlandı gibi sunulmaz.
- Yönetici panelindeki ürün/fiyat/şube/masa/personel ayarları ile kasadaki okuma ve yazma kaynakları eşleştirilmiştir; tutarsız ikinci veri modeli yoktur.
- Kasa yüzünün `apps/pos` içinde veya ayrı `apps/cashier` olarak konumlandırılmasına gerekçeli karar yazılmıştır.
- Seçilen ilk dilimin API komutları, yanıtları, durum geçişleri, idempotency, hata/sürüm çakışması ve auth bağlama noktası belgelenmiştir.
- Mühendis 2 ile ortak `CurrentActor/SessionContext` ve şube kapsamı arayüzü üzerinde anlaşılmıştır.
- Kabul senaryoları en az: garson siparişi, aynı siparişin tekrar gönderimi, iki ekranın ortak kaydı görmesi, geçersiz oturum/kapsam, API/LAN bağlantı hatası.
- Yapılan uygulama değişiklikleri ana domain sözleşmelerine ve [durum belgesine](DURUM_VE_YOL_HARITASI.md) aktarılmış; kalanlar açıkça listelenmiştir.
- Yerel API erişilebilirken kayıt önce kalıcı API/DB yanıtıyla onaylanır; merkez sync'i henüz yoksa veya bekliyorsa UI bunu dürüstçe gösterir. Yerel API'ye erişilemeyen durumda kayıt başarılı gösterilmez.

## Dosya sahipliği ve koordinasyon

Ana sahip: Mühendis 1. Ortak onay: koordinatör ve auth/oturum sahibi Mühendis 2. Kasa ekranı tasarımı, yönetici paneliyle operasyonel/veri uyumu, `sales`, `service`, `apps/pos` ve yeni POS yüzü bu görev alanıdır. `X-Demo-Actor`, kullanıcı/üyelik tabloları, oturum cookie/token politikası Mühendis 2 ile ortak onay olmadan değiştirilmez.

PR açıklamasında değişen domain/API, migration, idempotency ve hata senaryoları; auth bağlama noktası; güncellenen kalıcı belgeler belirtilir. İlk PR tercihen API/UI implementasyonundan önce sözleşme/ADR olur.
