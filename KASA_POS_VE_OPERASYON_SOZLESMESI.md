# HIPOS kasa, satış ve restoran operasyon sözleşmesi

Durum: Ürün hedefi ve uygulama öncesi sözleşme. Çalışan kodun envanteri [Backend Mimarisi ve Modül Bağımlılıkları](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) içindedir. Bu belge gerçek restoran kullanıcılarının günlük kasa/servis operasyonlarını tanımlar; müşteri adı ve kurulum tercihleri yapılandırılabilir olmalıdır.

## 1. Ürün yüzleri ve görevleri

| Yüz | Kullanıcı | Sorumluluk |
|---|---|---|
| Yönetim paneli | İşletme sahibi/yönetici | Ürün/fiyat, şube, personel, masa/istasyon, rapor ve yetki yapılandırması. Operasyonel satış ekranının yerine geçmez. |
| Garson | Garson | Masa seçme, adisyon görme, ürün/opsiyon/not ekleme, sipariş gönderme ve servis durumunu izleme. Kasa yetkisi verilmişse tahsilatı başlatabilir. |
| Kasa | Kasiyer/yönetici | Hızlı satış, masa/adisyon arama ve açma, tahsilat, ödeme yöntemi, fiş/ödeme sonucunu görme, iptal/iade yetkisi olan işlemler. |
| Mutfak | Mutfak personeli | Hazırlanacak siparişleri istasyon/öncelik sırasıyla görme, kabul/başlatma/hazır durumlarını güncelleme, iptal/değişikliği işaretleme. |
| Yerel servis/API | Restoran içi cihazlar | LAN üzerindeki ekranlara aynı şube verisini sunma; internet kesildiğinde ortak iş akışını sürdürme. |

Ekranların tamamı aynı sipariş/adisyon kimliklerini ve durum makinesini kullanır. Her cihazın kendi ayrı “demo sipariş” gerçeği olamaz.

## 2. Temel kavramlar

- **Sipariş:** Ürün, adet, seçilen opsiyon, not, fiyat snapshot'ı ve hazırlama yönlendirmesi olan müşteri talebi. Değişiklik geçmişi korunur.
- **Adisyon/check:** Bir masaya, hızlı satışa veya başka servis tipine bağlı ticari toplam. Bir veya daha fazla gönderilmiş sipariş ve sıfır/çoklu ödeme tahsili içerebilir. Açık/kapalı yaşam döngüsü sipariş durumundan ayrıdır.
- **Masa:** Şube içindeki servis yeri; tek aktif adisyon kuralı ilk işletme yapılandırmasında belirlenir. Aynı anda iki cihazdan açma için optimistic concurrency/unique active check gerekir.
- **Tahsilat:** Ödeme sağlayıcı veya nakit kabulü ile doğrulanmış ödeme kaydı. Ödeme girişimi ve kesinleşmiş tahsilat aynı şey değildir.
- **Fiş:** Mutfak hazırlık bileti veya müşteri mali belgesi anlamına gelebilir. Ürün dilinde `mutfak fişi` ve `mali belge` olarak ayrı adlandırılır. Mutfak yazıcısı mali ÖKC değildir.
- **Kasa vardiyası:** Kasiyerin nakit sayım/çekmece oturumu. Mevcut `cash` manuel vardiya MVP'si satış adisyonunu kapatmaz ve tahsilat yapmaz.

## 3. İlk kasa deneyimi

Kasa ana görünümünde kullanıcı hızlıca ürün bulup sepete ekleyebilmeli; kategori/arama, barkod girişi, adet, opsiyon, not, indirim yetkisi, vergi/fiyat özeti, müşteri seçimi (varsa), masa/adisyon ilişkilendirme, taslağı kaydetme ve ödeme başlatma akışları bulunmalıdır. Ekran touch cihazda büyük hedeflerle çalışmalı; fiziksel klavyeli barkod okuyucunun odaklı arama input'una karakter basma davranışı desteklenebilir.

Ana çalışma alanı en az şu bölümleri açıkça ayırır:

1. Satış modu: hızlı satış veya masa servisi.
2. Ürün/kategori/arama paneli.
3. Geçerli sepet ve miktar kontrolü.
4. Adisyon özeti ve varsa önceki gönderilmiş siparişler.
5. Ödeme yöntemleri ve sağlayıcı sonucu.
6. Mutfak gönderim ve müşteri/mali fiş sonucu.

Bağlantı durumu: `Online`, `Yerel ağda`, `Eşitleme bekliyor`, `Sunucuya erişilemiyor`, `Son eşitleme zamanı` olarak anlamlı biçimde gösterilir. Ekran, kaydedilmemiş veya yalnız cihazda bekleyen işlemi kalıcı/başarılı diye sunmaz.

## 4. Adisyon ve sipariş yaşam döngüsü

Önerilen domain ayrımı:

```text
Order: draft -> submitted -> accepted -> preparing -> ready -> served
                         \-> rejected / cancelled (gerekçe ve audit)
Check: open -> partially_paid -> paid -> closed
                 \-> voided (yetki, gerekçe, telafi kaydı)
PaymentAttempt: initiated -> pending -> succeeded | failed | cancelled | unknown
```

Bu başlangıç state diagram'ıdır; gerçek mutfak/KDS kabulü ve ödeme sağlayıcı durumlarıyla ADR üzerinden kesinleştirilmelidir. `unknown` sonucu kritik: bağlantı kesilince terminal yanıtı kaybolmuş olabilir; kullanıcıya yeniden tahsilat yaptırmadan önce idempotency/reference sorgusu gerekir. `submitted` sipariş tekrar gönderilince aynı `commandId` ikinci mutfak bileti üretmez.

Temel işlemler:

- Hızlı satış adisyonu aç, ürün ekle/çıkar, taslak kaydet ve mutfağa gönder.
- Masaya yeni adisyon aç, mevcut adisyona sipariş ekle, masayı/adisyonu yetki ve audit ile taşı veya birleştir.
- Kalem gönderilmeden önce düzeltilebilir; gönderildikten sonra değişiklik yeni change/cancel komutu olmalı, geçmişi silmemeli.
- Ödemeyi bir veya daha fazla yöntemle bölme ve kısmi ödeme sonraki ürün diliminde karara bağlanabilir. Veri modeli tek ödeme varsayımına kilitlenmemeli.
- Bakiye sıfır olduğunda adisyon otomatik kapanacak mı veya kasiyer onayı mı istenecek: ürün kararı olarak ilk ödeme entegrasyonundan önce belirlenir.
- İade/iptal eski ödeme/satış kaydını silmez; provider referanslı telafi kaydı üretir.

Her yazma komutu firma, şube, aktör, cihaz/istasyon, `commandId` (idempotency), beklenen kaynak sürümü ve UTC zamanı taşır veya API tarafından güvenli biçimde eklenir. Para tamsayı minor unit ve para birimi ile; vergi/fiyat kuralı backend'de hesaplanır. Ürün adı/fiyatı satış anında snapshot'lanır.

## 5. Ödeme ve mali cihaz sınırı

- Nakit, banka kartı, yemek kartı, hediye/diğer yöntemler ürün yapılandırması olabilir; her biri için başarı kaynağı tanımlanır.
- Simülatör `simulated: true` ve test ortamı etiketini taşır; gerçek tahsilat/fiş gibi görünen başarı mesajı üretemez.
- Kart tahsilatı yalnız yetkili terminal/provider'ın kesin başarı sonucu sonrası tahsil edilmiş kabul edilir. `pending`/`unknown` adisyonu kapatmaz ve kör tekrar tahsilat yapılmaz.
- Mali belgeyi yalnız uyumlu mali cihaz/ÖKC entegrasyonu oluşturur. Mutfak yazıcısına basılan hazırlık fişi mali belge değildir.
- Adapter arayüzü sağlayıcıdan bağımsız olmalı: başlat, durum sorgula, iptal/iade iste, dış referans, kesin/belirsiz sonuç, timeout/tekrar davranışı.
- Donanım modeli, işletim sistemi, sürücü, bağlantı (USB/LAN/Bluetooth/HID) ve üretici SDK'sı doğrulanmadan cihaz desteği vaat edilmez.

## 6. Mutfak ve yazıcı

Sipariş gönderiminde ürün kategorisi/ürün yapılandırmasından mutfak istasyonu belirlenir. Mutfak ekranı sipariş değişikliklerini sürümlü ve tekrar güvenli alır. Yazıcı adapter'ı ağ/USB yazıcıya çıktı gönderebilir; baskı durumu sipariş kaydının kendisinden ayrı izlenir. Yazıcı çevrimdışıyken sipariş kaybolmaz; ekranda baskı bekliyor/hata ve tekrar baskı (mükerrer kopya uyarısı) gösterilir.

En az ayrı çıktı türleri: mutfak hazırlık bileti, müşteri ödeme özeti/işletme fişi, mali fiş. Son ikisi sağlayıcı ve mevzuat kapsamı belirlenmeden gerçek gibi üretilmez.

## 7. Yetki ve audit

İlk sürümde ayrıca garson PIN'i yoktur; cihazda açık kullanıcı oturumu işlemin aktörüdür. Bu, gerçek HIPOS oturumu olmadığı anlamına gelmez. API firma/şube erişimini her istekte denetler; kullanıcı oturumunda geçersizse `401`, oturum var ama işlem kapsamı/yetkisi yoksa `403` döner. Hangi rolün indirim, adisyon taşıma, kapatma, iade ve vardiya kapatma yapacağı ayrı yetki matrisiyle kararlaştırılmalıdır. Cihaz ortak kullanıcıyla açılırsa işlem audit'inin kişi bazında izlenemeyeceği belirtilmeli ve bu risk pilot öncesi çözülmelidir.

Audit en az: kullanıcı, cihaz/istasyon, firma/şube, komut, eski/yeni durum, gerekçe, kaynak/provider referansı, UTC zaman ve trace/correlation kimliği.

## 8. Mevcut sistemle entegrasyon

- `catalog` ürün, kategori ve yayınlanmış fiyatların sahibidir.
- `sales` sipariş/adisyon iş alanının sahibidir; mevcut API kapsamı tam ödeme/kapama ürünü değildir.
- `service` masa ve masa-adisyon bağının sahibidir; siparişin sahibi değildir.
- `cash` manuel vardiya ve nakit hareket defterinin sahibidir; satış/tahsilat entegrasyonu bugün etkin değildir.
- `inventory` reçete/stok hareketlerinin sahibidir; satıştan otomatik stok tüketimi henüz karara bağlanmamıştır.
- `apps/pos` var olan test/geliştirme yüzüdür. Yeni kasa ürünü bunun sınırlarını büyütebilir veya ayrı `apps/cashier` uygulama yüzü olabilir; iş başlangıcında UI repo yapısı, PWA/install ve ortak component maliyetine göre ADR ile seçilir. API/domain aynı HIPOS monoreposunda kalır.

## 9. İlk kabul senaryoları

1. Yetkili kasiyer yayınlanmış üründen hızlı satış başlatır; fiyat snapshot'ı ve firma/şube doğru saklanır.
2. Aynı `commandId` ile sipariş gönderme tekrarlanırsa bir sipariş/tek mutfak bileti kalır.
3. İki cihaz aynı masaya eşzamanlı adisyon açınca yalnız bir aktif adisyon oluşur; diğer cihaz kullanıcıya çakışmayı anlaşılır gösterir.
4. Sipariş gönderildikten sonraki fiyat değişikliği eski siparişi etkilemez.
5. Başarısız/belirsiz kart yanıtı ödeme alındı veya adisyon kapandı olarak gösterilmez; tekrar tahsilatın güvenli kontrolü yapılır.
6. Mutfak ekranı ayrı istasyon siparişlerini görür; yazıcı hatası siparişin durumunu silmez ve yeniden baskı izlenir.
7. İnternet kesilirken yerel API erişilebilir olduğunda yeni cihazdan gelen sipariş diğer LAN ekranlarında görünür ve yerelde kalıcıdır.
8. İnternet geri gelince yerel kayıt merkezi veritabanına bir kez eşitlenir; yeniden denemeler çift satış/ödeme üretmez.
9. Kullanıcı kapsam dışı şubeye URL/ID değiştirerek erişemez.
10. Mutfak fişi, müşteri ödeme özeti ve mali belge etiketleri/adapter'ları karıştırılmaz.

## 10. Açık kararlar

İlk PR'lar öncesinde koordinator kararı bekleyenler:

- Yerel sunucu cihazı ve kalıcı disk/veritabanı dağıtım biçimi; merkezi servis ile yönlü/eş yönlü senkronizasyon modeli.
- İnternet varken istemci hangi API'ye yazar; her zaman yerel sunucu mu, bulut mu? Kesinti algılama ve LAN endpoint keşfi.
- Çevrimdışı katalog/fiyat güncelliği ve şubede internet yokken yeni ürün/fiyat düzenlemesinin engeli.
- Adisyon kısmi/multi-tender ödeme, veresiye, indirim, iptal/iade ve otomatik kapanış kuralı.
- Garsonun tahsilat alması için gereken rol/yetki; ilk varsayım ayrı PIN yok ama işlem yetkisi bulunabilir.
- Offline server/LAN da yokken cihaz içi kayıt kapsamı (şu an kapsam dışı/kararsız).
- İlk kullanılacak yazıcı, POS terminali ve ÖKC modeli/üretici SDK'sı.
- Satıştan reçete/stok düşümünün ne zaman ve hangi iptal/iade davranışıyla yapılacağı.
