# Ortak Adisyon Çekirdeği

> **Durum:** Uygulanmış Çekirdek Sözleşme
> **Son Güncelleme:** 22 Ekim 2026
> **Sorumlu:** Satış & Servis Mimarisi

> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu için:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim ve yol haritası için:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](../00-devir-rehberi/DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding için:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](../00-devir-rehberi/DEVIR_REHBERI.md)
> * **Tarihsel kararlar için:** [docs/05-gecmis-ve-arsiv/](../05-gecmis-ve-arsiv/)

---

> [!IMPORTANT]
> ### ⚠️ Adisyon Yaşam Döngüsü Gerçeklik Durumu
> `sales.checks` veri modeli ve sipariş bağları uygulanmıştır. Adisyonlar ağırlıklı olarak `open` kalır; `merged` yalnız birleştirme kaynak adisyonlarının tarihçesini belirtir. Ödeme sonrası `paid`/`closed` akışı henüz çalışmamaktadır.
>
> * **Adisyon oluşturma:** uygulanmış
> * **Birden fazla sipariş bağlama:** uygulanmış
> * **Masa/garson/müşteri ilişkileri:** kısmen uygulanmış
> * **Masa taşıma ve adisyon birleştirme:** uygulanmış (açık ve ödeme girişimi olmayan adisyonlarla sınırlı)
> * **Adisyon kapatma:** uygulanmamış
> * **İptal/iade:** uygulanmamış
> * **Gerçek ödeme:** uygulanmamış

Durum: `sales.checks` veri modeli ve listelenen API dilimleri uygulanmış durumdadır; bu sözleşme tam restoran POS'u, üretim güvenliği veya sağlayıcı entegrasyonu anlamına gelmez. Güncel ürün hedefi [Kasa/POS operasyon sözleşmesinde](KASA_POS_VE_OPERASYON_SOZLESMESI.md), mevcut kod sınırı [durum belgesinde](../00-devir-rehberi/DURUM_VE_YOL_HARITASI.md) tutulur. API `X-Demo-Actor` başlığıyla çalışır; bu başlık taklit edilebilir ve gerçek oturum/rol doğrulaması değildir.

## Kapsam

`sales.checks` her satışın ortak adisyon kaydıdır. Bir adisyon bir veya daha fazla `sales.orders` siparişi taşır. Ürün kalemleri siparişe bağlı kalır; `sales.payment_attempts` ödeme girişimleri siparişin kaynak bağlantısını korurken adisyona da bağlanır. Birleştirilen kaynak adisyon `status='merged'` ve `merged_into_check_id` ile korunur; siparişleri hedef adisyona taşınır. Firma ve şube kapsamı her okumada ve yazmada doğrulanır.

Adisyon ayrıntısındaki her siparişin `remainingMinor` değeri, ürün iptali/ikramı ve genel indirimin siparişe dağıtılan payı düşüldükten sonra başarılı simüle ödemeler çıkarılarak hesaplanır. Bu değer ödeme simülatörünün aynı sipariş için kullandığı ödenebilir tutarla aynı dağıtım kuralını kullanır; sipariş `totalMinor` ve kalem fiyatları brüt geçmiş bilgisi olarak korunur.

Adisyonda `customer_id`, `table_id` ve `waiter_id` nullable'dır. Self servis için üçü de boş olabilir. Adisyon/sipariş oluşturma kasa, cari veya muhasebe hareketi üretmez. Ödeme simülatörü varsayılan olarak kasa hareketi üretmez; yalnız garson check tahsilatının `postToCash=true` yolu başarılı olduğunda açık vardiyaya satış hareketi ekler. Cari veya muhasebe hareketi bu akışta da oluşmaz.

## Capability sahipliği

- `sales.checks`, adisyon oluşturma ve adisyona sipariş ekleme için yazma kapısıdır. Kapalıyken geçmiş liste ve detay okumaları çalışır; yeni yazmalar reddedilir.
- `sales.pos_orders` geriye dönük test POS uçlarını yönetir ve `sales.checks` özelliğine bağlıdır. Eski sipariş uçları her sipariş için aynı transaction'da self-servis adisyonu oluşturur.
- `cari.management`, `customer_id` doğrulamasının sahibidir. Kimlik yalnız aynı firma/şubedeki aktif `customer` tipli cari kaydıysa kabul edilir. Müşteri alanı boşken bu capability gerekmez.
- `staff.records`, personel kartı ve servis personeli bölüm bilgisinin sahibidir. `service.waiters`, personeli adisyona garson olarak atamanın sahibidir. `waiter_id` verilirse iki capability de açık olmalı; personel aynı şubede aktif ve `service` bölümünde olmalıdır.
- `branches.tables`, masa kartı ve masa atamasının sahibidir. Bu kapı kapalıyken `table_id` içeren yeni işlem reddedilir; null masa ile self servis çalışır.
- Masa taşıma ve birleştirme servis endpoint'leri `branches.tables` ile `sales.checks` yeteneklerini birlikte gerektirir. Birleştirme, ödeme girişimi olmayan açık adisyonlarla sınırlıdır.
- `payments.simulator`, yeni simüle ödeme girişimini yönetir. Check uçlarında ödeme başlatmak için ayrıca `sales.checks` açık olmalıdır. Başlamış bekleyen/belirsiz girişim mevcut sonuçlandırma kurallarıyla tamamlanabilir.
- Check tahsilat endpoint'inde `postToCash=true` yalnız garsonun başarılı nakit/kart tahsilatı için kullanılır ve `cash.management` capability'sini de gerektirir. Aynı firma/şubede tam bir etkin açık vardiya kilitlenir; yoksa veya birden fazlaysa tahsilat reddedilir. Kasa hareketi ve audit, ödeme attempt'i/adisyon kapanışıyla aynı PostgreSQL transaction'ında kaydedilir. Nakit hareketi beklenen nakde eklenir; kart hareketi yalnız gelir/tahsilat geçmişinde görünür. Diğer Payment Simulator çağrıları varsayılan olarak kasa hareketi oluşturmaz.

## Masa bağının anlamı

`sales.checks.table_id` adisyonun şu an bağlı olduğu masayı gösteren güncel durum alanıdır. `service.assignments` ise `check_id`, `order_id`, masa, garson, açılma ve kapanma zamanıyla servis ilişkisinin geçmişidir. Açık assignment bulunduğunda `check.table_id` ile `assignment.table_id` aynı olmalıdır. Assignment açılması ikisini aynı transaction'da yazar; assignment kapatılması assignment geçmişini korur ve adisyonun güncel masa/garson bağını temizler. Migration sırasında eski açık assignment'lar güncel adisyon alanlarını doldurur; kapalı satırlar geçmiş olarak korunur.

## API

- `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks`: `requestId`, `firstOrderId`, `items` ve isteğe bağlı `customerId`, `tableId`, `waiterId` ile adisyonu ve ilk siparişi aynı transaction'da oluşturur.
- `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/orders`: var olan açık adisyona yeni `orderId` ve `items` ekler.
- Sipariş `items` kalemi isteğe bağlı `note` (en fazla 500 karakter) ve `options: [{ groupId, optionId, quantity }]` alanlarını kabul eder. İstemci grup/seçenek kimlikleri ve adet gönderir; ad/fiyat kaynağı katalogdur. Sunucu ürünün güncel grup bağlarını, seçim sınırlarını ve seçenek adetini doğrular; grup/seçenek pasifliği tek başına reddetme nedeni değildir. Ürün pasifse sipariş reddedilir. Temel birim fiyatına seçilen seçenek farkları (adetle çarpılarak) eklenir; sonuç negatifse reddedilir, sıfır kabul edilir. `sales.order_lines.base_unit_price_minor`, `unit_price_minor` ve `options_json` satış anı değerlerini saklar; adisyon/kalem ve mutfak yanıtları seçenek snapshot'larını döndürür.
- `GET /api/v1/firms/{firmId}/branches/{branchId}/sales/checks`: filtresiz çağrıda son 100 adisyonu listeler. `?tableId={tableId}` verildiğinde seçilen masanın tüm açık adisyonlarını döndürür; masa operasyonları bu sorguyu kullanarak genel liste sınırından etkilenmez.
- `GET /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}`: adisyon, sipariş/kalemler, toplanmış TRY tutarları ve ödeme girişimlerini döndürür.
- `GET /api/v1/firms/{firmId}/sales/orders?branchId={branchId}`: garson/POS demo aktörü yalnız erişebildiği belirtilmiş şubenin siparişlerini okuyabilir; şubesiz veya başka şube isteği reddedilir. Yönetici ve salt okunur demo aktörleri mevcut kapsam kurallarına tabidir.
- `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/payment-attempts`: gövdedeki `orderId` adisyana bağlı olmalı; ödeme girişimi mevcut simülatör durum makinesini kullanır. Opsiyonel `postToCash=true`, başarılı garson tahsilatını açık kasa vardiyasına idempotent kasa hareketi olarak bağlar; yalnız UI'dan gelen istemci beyanı değil, sunucu vardiya/capability kontrolü de gerekir.
- `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/payment-attempts/{attemptId}/resolve`: adisyana ait bekleyen/belirsiz girişimi mevcut simülatör kurallarıyla sonuçlandırır.
- `POST /api/v1/firms/{firmId}/branches/{branchId}/service/tables/{sourceTableId}/transfer`: `requestId`, `targetTableId` ve `expectedVersion` ile mevcut açık adisyonu boş hedef masaya taşır.
- `POST /api/v1/firms/{firmId}/branches/{branchId}/service/tables/{targetTableId}/merge`: `requestId`, `sourceTableIds` ve kaynak/hedef assignment sürümlerini içeren `expectedVersions` ile kaynak siparişleri hedef masanın mevcut açık adisyonına taşır. Kaynak adisyonlar `merged` durumunda, hedef adisyon kimliğiyle geçmişte tutulur. Herhangi bir kaynak veya hedef adisyonda ödeme girişimi varsa işlem reddedilir.

Masa birleştirmede indirim, ikram ve iptal kayıtları aynı transaction içinde hedef adisyona taşınır; tutar, gerekçe, aktör, işlem kimliği ve kalem ilişkisi korunur. Kaynağın ilk adisyon kimliği `original_check_id` ile saklanır; mevcut hedef işlemleri yerinde kalır. Genel indirimlerin tutarı değişmez; birleştirilmiş adisyonun siparişlerine mevcut orantılı dağıtım kuralı uygulanır. Ödeme girişimi bulunan adisyon yasağı sürer. Bunun için `PreserveMergedAdjustmentOrigin` migration'ı gerekir.

Yeni yazılarda istek kimliği idempotenttir. Aynı kimlik ve aynı içerik mevcut kaydı döndürür; başka içerikle tekrar kullanım `409` ile reddedilir. Sipariş ve ödeme kimlikleri de kendi mevcut idempotency kurallarını korur.

## Migration sırası

1. Expand migration nullable `check_id` kolonlarını ekler; sipariş başına bir check üretir, sipariş ve ödeme girişimlerini bağlar, mevcut sipariş audit olaylarını check audit'e taşır.
2. Service expand migration nullable assignment `check_id` ekler; mevcut `order_id` üzerinden atamaları check'e bağlar ve açık atamaların `checks.table_id`/`waiter_id` durumunu kurar.
3. API bütün yeni sipariş, ödeme ve assignment yazılarında check bağını zorunlu yazar; eski uçlar da check oluşturmadan sipariş yazamaz.
4. Contract migration'ları backfill tamamlandıktan sonra `sales.orders.check_id`, `sales.payment_attempts.check_id` ve `service.assignments.check_id` alanlarını `NOT NULL` yapar. FK ilişkileri check kayıtlarını korur. `order_id`, ödeme kaynağı ve servis geçmişi için tutulur.

Mevcut satırlar veya kapsam eşleşmeleri eksikse migration hata vererek durmalıdır. Siparişler, kalemler, ödemeler, audit olayları ve assignment geçmişi silinmez.

## Kabul senaryoları

- Ürün kalemli müşteri/masa/garson bağlantısız self servis adisyonu oluşturma.
- `cari.management` açıkken aynı şubeden müşterili self servis ve masa servisi adisyonu oluşturma.
- Müşteri olmadan masa servisi ve müşterili/garsonsuz masa servisi oluşturma.
- Masa ve garson capability'leri kapalıyken self servis oluşturma; aynı koşulda masa veya garson kimlikli yazmayı reddetme.
- `sales.checks` kapalıyken yazmayı reddetme, geçmiş okumasını sürdürme.
- Farklı firma/şube müşterisi, masası, garsonu veya adisyonu ile yazmayı reddetme.
- Açık assignment ve `checks.table_id` eşleşmesini doğrulama; assignment kapanınca geçerli masa bağının temizlenmesini, geçmiş atamanın korunmasını doğrulama.
- Aynı adisyana birden fazla sipariş ekleyip toplam ve ödeme özetini doğrulama.
- İlk siparişin tüm kalemlerini başka adisyona bölme; sipariş/kalem kimlikleri, masa bağlantısı ve sipariş geçmişinin korunmasını, iki adisyon toplamının değişmemesini ve aynı istek tekrarının yeni kayıt oluşturmamasını doğrulama.
- Açık adisyonu boş masaya taşıma; dolu hedefi ve eski sürümü reddetme; aynı `requestId` tekrarını idempotent yanıtlama.
- Ödemesiz kaynak adisyonları hedef açık adisyona birleştirme; kaynak adisyonun `merged_into_check_id` bağını, sipariş geçmişini ve assignment/audit kayıtlarını koruma; ödeme denemesi olan birleştirmeyi reddetme.
- Backfill sonrası sipariş, ödeme, audit ve assignment satırlarının kimlik ve sayılarının korunduğunu doğrulama.
- Genel ödeme simülatörünün ve kasiyer test ödemelerinin yalnız sales verisi üretmesi; kasa, cari veya muhasebe hareketi üretmemesi.
- Garson check ödemesinde `postToCash=true` ile başarılı nakit/kartın tek kasa hareketi ve audit üretmesi; nakdin beklenen çekmeceyi artırması, kartın artırmaması; başarısız/bekleyen/belirsiz sonucun hareket üretmemesi; aynı attempt tekrarında yinelenmemesi; vardiya yok/çokluysa ödeme girişiminin de kaydedilmeden reddedilmesi.
