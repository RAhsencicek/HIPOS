# Restoran Yönetim Platformu — Ana Ürün Dokümanı

> Bu belge geniş ürün vizyonudur. Güncel backend, bağımlılıklar ve uygulama sınırları için [Backend Mimarisi ve Modül Bağımlılıkları](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md); teslim/kalan işler için [Durum ve Yol Haritası](DURUM_VE_YOL_HARITASI.md) ve [İlk Üç Aşama](ILK_UC_ASAMA.md) esas alınır. Tek şube demo ürün detayındaki reçete `VITE_INVENTORY_PROVIDER=http` ile kalıcı API'den okunabilir; stok/sayım MVP'si PostgreSQL'e yazılır. Kapsam ve tamamlanmayan kısıtlar kanonik belgededir.

Durum: İlk ürün tanımı. Bu belge, kesinleşen kararları kaydeder; `Açık karar` olarak işaretlenen konular henüz kararlaştırılmamıştır.

## 1. Ürünün amacı

Restoran işletmelerinin ayrı yazılımlarda yürüttüğü yönetim işlerini tek platformda birleştirmek. İşletme ihtiyaç duyduğu modülleri firma ve şube bağlamında açıp kapatır. Etkinleşen özellikler ortak ürün, sipariş, ödeme, stok, mutfak, raporlama ve yönetim verileriyle uyumlu çalışacak biçimde tasarlanır.

Ürün tek şubeli işletmede sade, çok şubeli veya çok markalı işletmede kapsamı açık bir deneyim sunmalıdır. Ana ilke: Aynı yönetim paneli farklı ölçeklerde kullanılabilir; işletme büyüdüğünde veriyi veya arayüzü baştan kurmak gerekmez.

### İlk tanıtımın sınırı

İlk tanıtım tek şubeli bir işletmenin yönetici başlangıç ekranı ve günlük yönetim temelidir. Ürün/katalog, cari, masa servisi, test POS, ödeme simülatörü ve temel reçete/stok/sayım dilimleri PostgreSQL'e bağlıdır; bu, uçtan uca veya üretime hazır restoran sistemi anlamına gelmez. Satıştan stok tüketimi, barkod, satın alma/depo, gerçek yetki ve tahsilat kapsam dışıdır. Ekran her veri alanında örnek, API, kapalı veya henüz etkin değil durumunu açıkça göstermelidir. Güncel gerçeklik için bu belgenin üstündeki kanonik backend ve durum belgelerine bakın.

Gelecekte aynı ürün ailesine POS/kasa, garson, mutfak/KDS, kurye, QR/web müşteri, kiosk ve patron/mobil raporlama yüzleri eklenebilir. Bu yüzler ilk projenin kullanıcı ekranları değildir. İlk tasarımda bunlara ait verilerin ve durumların yönetim panelinde nasıl izleneceği düşünülür.

## 2. Hedef kullanıcı ve işletme

İlk panelin kullanıcıları firma sahibi, genel müdür, bölge/merkez yöneticisi, şube müdürü, operasyon yöneticisi, finans yöneticisi, rapor kullanıcısı ve sistem yöneticisidir. İlk frontend sürümünde hepsi aynı yönetim menülerini ve ekranlarını görür. Rol bazlı menü gizleme veya işlem ayrıştırma bu aşamanın önceliği değildir. Gelecek backend firma, şube, rol ve izin bazlı veri ve işlem ayrımına hazırlanmalıdır. Firma ve şube verisi birbirine karışmamalıdır.

İlk gerçek giriş yöntemi HIPOS hesabıdır (e-posta/şifre). Google/Gmail veya diğer harici hesaplarla giriş daha sonraki seçeneklerdir; ilk yayın için şart değildir. Hesap kimliği ile firma/şube üyeliği ayrı tutulur; aynı yönetim arayüzünü görme kararı sunucudaki veri kapsamı denetimini kaldırmaz. İlk hesap ve davet akışı [Kimlik ve Hesap Akışı](KIMLIK_VE_HESAP_AKISI.md) içinde tasarlanır.

Garson, kasiyer, mutfak personeli, kurye ve müşteri bu panelin kullanıcıları değildir.

Uzun vadeli hedef; bağımsız restoran, zincir, franchise, pizza, kahvaltı, kafe, bar, hızlı servis, fine dining, pastane, bulut mutfak ve paket servis işletmeleridir. İlk tasarım iki senaryoda doğrulanır: tek şubeli pizza/kahvaltı işletmesi ve en az iki şubeli restoran.

İlk pazar Türkiye'dir. Arayüz ve rapor dili Türkçe, varsayılan para birimi Türk lirasıdır. KVKK, KDV, e-Fatura/e-Arşiv, e-Adisyon, ÖKC, yerel bankalar, yemek platformları ve yemek kartları kapsamda görünür; mevzuata uygunluk veya gerçek bağlantı tamamlanmış gibi sunulmaz.

## 3. İşletme yapısı ve kapsam seçimi

Hedef yapı `Firma → [Marka] → Şube` biçimindedir. Marka isteğe bağlıdır. Örnekler:

```text
ABC Restoran Grubu → Kadıköy Şubesi
ABC Restoran Grubu → PizzaMarka → Kadıköy Şubesi
```

Bağlam seçici, kullanıcının baktığı firmayı, varsa markayı ve şubeyi açıkça gösterir. Tek markalı basit işletmede marka satırı gizlenebilir. Çok şubeli görünümde “Tüm şubeler” kapsamı ile tek şube kapsamı ayrıdır. Bir ekranda gösterilen veri, yapılan yapılandırma ve uygulanacak modül değişikliği seçili kapsamla ilişkilendirilir. İlk backend sürümünde firma ve şube yeterli olsa bile arayüz ve veri sözleşmeleri isteğe bağlı marka alanına genişleyebilmelidir.

## 4. Yöneticinin yetki sınırı

Yönetici operasyonu izler; menü, fiyat, kampanya, modül, şube, kullanıcı ve entegrasyon ayarlarını yönetir; raporları inceler. Satın alma talebi, satın alma siparişi, mal kabul, stok sayımı, fire, gider ve mutabakat da yetkili arka ofis kullanıcısının **yönetsel iş akışlarıdır**. Bu işlemlerin ilk prototipte gösterilmesi, backend üzerinden gerçekten kayıt oluşturdukları anlamına gelmez.

Yönetici sipariş oluşturmaz; garson yerine sipariş girmez; servisi tamamlanmış işaretlemez; mutfak işini başlatmaz veya hazır yapmaz; ödeme tahsil etmez; kurye teslimatını tamamlamaz. Masa doluluğu, açık adisyon, sipariş kalemleri ve kanalı, mutfak ve ödeme durumu ile şube performansı salt okunur izlenir. Aynı ilke rezervasyon karşılama, teslimat durumu değiştirme ve benzeri günlük operasyon eylemlerine uygulanır.

İptal, iade, yüksek indirim, masa taşıma ve stok düzeltmesi gibi istisnai müdahaleler ileride özel izin, onay ve işlem geçmişi ile değerlendirilebilir. İlk frontend'de günlük operasyon eylemi olarak sunulmaz.

## 5. Görünen özellik ile çalışan özellik ayrımı

Her ekran ve işlem aşağıdaki durumlarından biriyle tanımlanır:

| Durum | Kullanıcıya anlamı | Arayüz davranışı |
| --- | --- | --- |
| Gerçek işlem | Gerçek backend'e bağlıdır ve kalıcı sonuç üretir. | Başarı/hata sonucu sunucudan doğrulanır. |
| Prototip / akış gösterimi | Ekran ve adımlar incelenebilir; gerçek kayıt oluşturulmaz. | “Bu akış henüz gerçek kayıt oluşturmaz” açıklaması görünür. |
| Planlandı | Ürün kapsamındadır; akış henüz tasarlanmamış veya uygulanmamıştır. | Kapsam ve beklenen değer açıklanır; sahte eylem sunulmaz. |

İlk frontend aşamasında backend bulunmadığından tüm kaydetme davranışları açıkça prototip olarak etiketlenir. Örnek veri kullanılabilir; örnek olduğu görünür. Gerçek işlem etiketi ancak gerçekten bağlı, doğrulanmış API için kullanılır. “Başarılı kaydedildi”, “ödeme alındı” veya “entegrasyon bağlandı” gibi bildirimler gerçek sonuç yoksa gösterilmez.

Ek kurulum ve bağlantı durumları: `Kapalı`, `Kurulum gerekiyor`, `Sağlayıcı bekleniyor`, `Bağlantı kurulmadı`, `Pilot gerekiyor`, `Yakında`. Bunlar gerçek/prototip/planlandı olgunluk durumundan ayrı düşünülür. Örneğin bir entegrasyon planlanmış ve aynı anda sağlayıcı bekliyor olabilir.

Eski proje aşama ve bileşen kodları bu dokümanda kullanılmaz. Yol haritası işlevlerin açık adlarıyla anlatılır.

## 6. Modüler çalışma ilkesi

Temel yönetim alanları ana menüde görünür kalır. Seçili şubede bir modül kapalıysa alan erişilebilir, işlem pasif ve şu tür bir yönlendirme görünür: “Bu özellik bu şubede kapalı. Ayarlar → Modüller ve Özellikler bölümünden açabilirsiniz.” Tüm modüller ve alt özellikler katalogda her zaman bulunabilir. Bağımsız alt özelliklerin ana menüde ayrı sayfa gerektirip gerektirmediği ekran tasarımında kararlaştırılır; katalogdaki bulunabilirliği korunur.

Etkinleştirme kapsamı açıkça belirtilir. A1 şubesinde stok açılması A2 şubesini veya başka firmayı etkilemez. Açmadan önce gerekli hazır bağımlılıklar, eksik işletme verisi ve dış sağlayıcı gereksinimleri görünür bir aktivasyon planında gösterilir. `Kurulum gerekiyor` ve `Sağlayıcı bekleniyor` durumları başarı olarak gösterilmez.

Gelecek backend için modül durumu, veri varlığından ayrı tutulmalıdır: modülü kapatmak geçmiş kayıtları silmez veya şemayı değiştirmez; yeniden açmak kaydı çift oluşturmaz. Ön yüz seçili firma/şube kapsamını her ayar ve veri isteğinde taşımaya hazırlanır. Açma/kapama işlemi gerçek backend geldiğinde tek bir doğrulanmış sonuçla ekrana yansır. Bu ilk frontend belgesi, veritabanı davranışının uygulandığını iddia etmez.

## 7. Yönetim paneli bilgi mimarisi

Aşağıdaki alanlar ilk frontend'in görünür ürün haritasıdır. Her alanın ana sayfası, alt sayfaları, listesi, detayı, filtreleri ve durumları ekran tasarımında ayrıca belirtilecektir.

| Ana alan | Alt ekranlar ve içerik | Yönetici davranışı |
| --- | --- | --- |
| Genel Bakış | Günlük durum, şube ve masa doluluğu, açık sipariş, mutfak kuyruğu, hazır işler, kritik stok, satış, kampanya, entegrasyon sağlığı, son yönetsel işlemler | İzler; ilgili ayrıntıya gider. |
| Şubeler ve Canlı Durum | Şube listesi/detayı, masa planı, açık adisyon, mutfak yoğunluğu, şube karşılaştırması, şube modülleri, ürün ve fiyat durumu | Operasyonu salt okunur izler; şube yapılandırmasına gider. |
| Ürünler ve Menü | Menüler, kategoriler, ürünler, seçenek grupları, alerjenler, görseller, menü kompozisyonu, kanal/şube görünürlüğü, fiyatlar, fiyat sürümleri, ileri tarihli fiyatlar, yayınlama/geçmiş | Katalog, fiyat ve yayını yönetir. |
| Satışlar ve Adisyonlar | Satış özeti, açık/kapanan/iptal adisyonlar, ikram, indirim, iade, kanal/masa/paket/QR satışları, mutfak durumları | Sipariş ve ödeme akışını salt okunur inceler. |
| Cari ve Müşteriler | Müşteriler, cari hesaplar, gruplar, geçmiş, segmentler, sadakat, kuponlar, izinler, iletişim ve geri kazanma | Müşteri ve pazarlama kapsamını yönetir; veri durumuna göre prototip/planlı gösterir. |
| Kasalar | Kasa özeti/hareketleri/vardiyaları, açılış/kapanış, ödeme türleri, iadeler, kasa farkı, gün sonu | Finansal durumu izler; gerçek tahsilat yapmaz. |
| Giderler ve Finans | Giderler/kategoriler, cari borç/alacak, tedarikçi borcu, banka hareketi, kasa-banka mutabakatı, dönem/vergi özeti, mali belgeler, muhasebe aktarımı | Yetkili arka ofis işlemlerini tasarlar veya gerçekleştirir; olgunluk durumu açık gösterilir. |
| Stok ve Satın Alma | Stok özeti, kritik stok, hammadde, stok ürünü, birimler/dönüşümler, depolar, reçete/sürümler, üretim, fire, sayım, düzeltme, transfer, tedarikçi, talep, sipariş, mal kabul, alış faturası, maliyet, menü mühendisliği, hareket geçmişi | Stok ve tedarik yönetimini gösterir; gerçek kayıt yalnız bağlı backend ile oluşturulur. |
| Mutfak ve Servis | Mutfak özeti, istasyonlar, KDS işleri, hazırlık süreleri, gecikmeler, yazıcı yedekleri, servis durumu, garson çağrısı, istasyon performansı | Salt okunur izler. |
| Raporlar | Satış, ürün, kategori, kanal, şube, kasa, ödeme, stok, maliyet, personel, mutfak, iptal/ikram, rezervasyon, kurye, sadakat, gelecekte öneriler | Kapsam ve tarih filtresiyle analiz eder; veri kaynağı belirtilir. |
| Merkezi Yönetim | Marka/şube grubu, merkezi menü/fiyat/kampanya, şubelere yayın, geçmiş, istisna, geri alma, konsolide rapor, kıyaslama | Merkez kararlarının kapsamını ve etkisini görür; bağlıysa yönetir. |
| Ayarlar | Modüller ve Özellikler, kullanıcılar/yetkiler, entegrasyonlar, cihazlar, bildirimler, para birimi, vergi, ödeme, şube ve sistem ayarları | Paneli yapılandırır; tamamlanmamış bağlantıları açıkça görür. |

### Ürün ayrıntısında beklenen bilgiler

Ürün adı, kategori, açıklama, görsel, alerjen, seçenek grubu, üretim istasyonu, POS/QR/kiosk/paket servis görünürlüğü, şube kapsamı, fiyat, reçete bağlantısı, kampanya uygunluğu, aktiflik ve taslak/yayın durumu. Kanal görünürlüğü, ilgili kanal ekranının ilk projede yapılacağı anlamına gelmez.

### Stok özeti ve reçete ayrıntısı

Stok özetinde toplam stok değeri, kritik stok sayısı, bekleyen satın alma, son mal kabulleri, fire, en çok tüketilen hammaddeler ve şube/depo durumu bulunur. Reçetede satış ürünü, sürüm, hammadde, miktar, birim, fire oranı, porsiyon maliyeti, geçerlilik tarihi ve etkin şubeler gösterilir. Verisi veya backend'i olmayan hesaplamalar örnek/planlı olarak işaretlenir.

### Satın alma akışı

Tedarikçi → talep → onay → sipariş → mal kabul (eksik/fazla dahil) → fatura bağlantısı → maliyet güncelleme akışı, şube ve depo kapsamıyla tasarlanır. İlk frontend'de gerçek kayıt veya onay oluşmadığında her adım prototip olarak görünür.

## 8. Ortak ekran sözleşmesi

Her ekranın ayrıntılı tanımı şu başlıkları içerir:

1. Ekran adı, amacı ve kullanıcıya değeri.
2. Firma, isteğe bağlı marka ve şube kapsamı; kapsam değiştiğinde davranış.
3. Ana ekran, alt menü, liste, detay, filtre, sıralama, arama ve durumlar.
4. Gösterilen veriler ve veri kaynağı; salt okunur bilgiler.
5. Yapılabilen yönetsel işlemler; yapılamayan günlük operasyon işlemleri.
6. Kullanılan modüller ve bağımlılıklar; etkinleştirme/kurulum yolu.
7. Her işlem için gerçek, prototip veya planlandı durumu; sağlayıcı ve kurulum durumu.
8. Boş, yükleniyor, hata, yetkisiz ve modül kapalı durumları.
9. Kabul senaryoları: tek şube, çok şube, kapalı modül, eksik veri ve başarısız işlem.

Yetkisiz durum ilk frontend'de rol bazlı menü ayrımı gerektirmez; gelecekteki erişim reddinin kullanıcıya nasıl açıklanacağını tarif eder.

## 9. Entegrasyon görünürlüğü

Katalogda Yemeksepeti, GetirYemek, Trendyol Yemek, Migros Yemek, banka/ödeme, sanal POS, yemek kartları, ÖKC, e-Fatura/e-Arşiv, yazıcı, terazi, Caller ID, menuboard ve muhasebe/ERP grupları görünür. Her biri gerçek bağlantı durumu, gerekli kurulum, pilot ve planlama bilgisiyle gösterilir. İlk frontend'de dış sağlayıcı bağlantısı kurulmaz ve sahte “bağlandı” durumu kullanılmaz.

## 10. Ödeme ve raporlama için gelecekteki gereksinimler

Gelecek ödeme/kasa aşaması kısmi ve karma ödemeyi, belirsiz ödeme sonucunu, iade sözleşmesini, kasa vardiyasını, mutabakatı ve ilk rapor projeksiyonunu kapsar. Gerçek sağlayıcı yerine simülatör kullanılabilir; bu da açıkça belirtilir. Ödeme doğrulanmadan sipariş kapanmış sayılmamalı, belirsiz sonuç başarıya çevrilmemeli ve yinelenen istek çift tahsilat oluşturmamalıdır. Satış ve ödeme raporları aynı tanımlı hesaplama kurallarına dayanmalıdır. Mali belge, ÖKC ve gerçek banka bağlantıları sonraki entegrasyon çalışmalarıdır.

## 11. İlk frontend için kabul ölçütleri

- Panel tek şubeli ve çok şubeli örnekte anlaşılır; seçili firma/şube kapsamı kaybolmaz.
- Temel yönetim alanlarının tamamı bulunabilir; alt işlerin ne olduğu kullanıcıya görünür.
- Yönetici ekranında sipariş girme, ödeme alma, mutfak veya servis durumunu değiştirme eylemi bulunmaz.
- Kapalı modül kataloğundan bulunur; ilgili alanda neden kullanılamadığı ve açma yolu anlaşılır.
- Gerçek backend'e bağlı olmayan hiçbir akış kalıcı kayıt, başarılı entegrasyon veya tahsilat iddia etmez.
- Ekranlar boş, yükleniyor, hata, kapalı modül ve kurulum gereken durumlarda yönlendirici mesaj verir.
- Ürün/menü, stok/satın alma, satış izleme, şube bağlamı ve modül yönetimi en az birer uçtan uca prototip senaryosunda gezilebilir.
- Türkçe metinler, Türkiye para biçimi ve masaüstü/tablet kullanımında okunabilir düzen sağlanır.

## 12. Açık kararlar

Bu belge ekran tasarımı başlamadan önce aşağıdaki konuları karara bağlamak için kullanılacaktır:

- İlk prototipin verisi sayfa yenilemelerinde yerel olarak korunacak mı, yoksa her açılışta örnek senaryoya mı dönecek?
- Ürün/fiyat/menü yayınlama akışlarının ilk prototipte hangi adımları etkileşimli olacak?
- Çok şubeli merkez ayarının şubeye uygulanması ve şube istisnası ilk prototipte hangi örnekle gösterilecek?
- Rezervasyon, personel vardiyası ve teslimat yönetimi ürün haritasına hangi ana alan altında eklenecek?
- Tasarım referansının somut renk, yerleşim ve bileşen kalıpları [Görsel Tasarım Yönü](TASARIM_YONU.md) içinde belgelendi; gerçek marka adı/logo ve son erişilebilirlik ayarları tasarım sırasında netleşecek.

Bu açık kararlar, yukarıdaki kesinleşmiş ürün sınırlarını değiştirmez. Ekran bazlı ayrıntılı tanımlar ve görsel tasarım kararları bu ana dokümana bağlı olarak geliştirilecektir.

## 13. Proje başlangıcı ve teknik yaklaşım

Çalışma alanı boş olarak başlamıştır; mevcut uygulama veya eski proje kodu bu ürünün temeli kabul edilmez. İlk uygulama yönetim panelidir. Modüler frontend sınırları, veri sözleşmeleri ve örnek veri kaynakları baştan tanımlanır; diğer ürün yüzleri ihtiyaç doğduğunda eklenir. Teknoloji seçimi ve modül kuralları [Teknik Mimari](TEKNIK_MIMARI.md) belgesindedir.

İlk örnek veri biçimi ve API yanıtları [API ve Mock Veri Sözleşmesi](API_VE_MOCK_SOZLESMESI.md) içinde tasarlanmıştır. Modül kullanımdayken kapatılırsa yeni iş başlatılmaz, devam eden kritik işler güvenli şekilde sonuçlanır ve geçmiş kayıtlar okunabilir kalır. Görsel tasarım için kullanıcı tarafından seçilen referans [Görsel Tasarım Yönü](TASARIM_YONU.md) belgesinde somutlaştırılmıştır.
