# Ortak Adisyon Çekirdeği

## Kapsam

`sales.checks` her satışın ortak adisyon kaydıdır. Bir adisyon bir veya daha fazla `sales.orders` siparişi taşır. Ürün kalemleri siparişe bağlı kalır; `sales.payment_attempts` ödeme girişimleri siparişin kaynak bağlantısını korurken adisyona da bağlanır. Firma ve şube kapsamı her okumada ve yazmada doğrulanır.

Adisyonda `customer_id`, `table_id` ve `waiter_id` nullable'dır. Self servis için üçü de boş olabilir. İlk sürümde adisyon, sipariş ve ödeme simülasyonu kasa, cari veya muhasebe hareketi üretmez.

## Capability sahipliği

- `sales.checks`, adisyon oluşturma ve adisyona sipariş ekleme için yazma kapısıdır. Kapalıyken geçmiş liste ve detay okumaları çalışır; yeni yazmalar reddedilir.
- `sales.pos_orders` geriye dönük test POS uçlarını yönetir ve `sales.checks` özelliğine bağlıdır. Eski sipariş uçları her sipariş için aynı transaction'da self-servis adisyonu oluşturur.
- `cari.management`, `customer_id` doğrulamasının sahibidir. Kimlik yalnız aynı firma/şubedeki aktif `customer` tipli cari kaydıysa kabul edilir. Müşteri alanı boşken bu capability gerekmez.
- `staff.records`, personel kartı ve servis personeli bölüm bilgisinin sahibidir. `service.waiters`, personeli adisyona garson olarak atamanın sahibidir. `waiter_id` verilirse iki capability de açık olmalı; personel aynı şubede aktif ve `service` bölümünde olmalıdır.
- `branches.tables`, masa kartı ve masa atamasının sahibidir. Bu kapı kapalıyken `table_id` içeren yeni işlem reddedilir; null masa ile self servis çalışır.
- `payments.simulator`, yeni simüle ödeme girişimini yönetir. Check uçlarında ödeme başlatmak için ayrıca `sales.checks` açık olmalıdır. Başlamış bekleyen/belirsiz girişim mevcut sonuçlandırma kurallarıyla tamamlanabilir.

## Masa bağının anlamı

`sales.checks.table_id` adisyonun şu an bağlı olduğu masayı gösteren güncel durum alanıdır. `service.assignments` ise `check_id`, `order_id`, masa, garson, açılma ve kapanma zamanıyla servis ilişkisinin geçmişidir. Açık assignment bulunduğunda `check.table_id` ile `assignment.table_id` aynı olmalıdır. Assignment açılması ikisini aynı transaction'da yazar; assignment kapatılması assignment geçmişini korur ve adisyonun güncel masa/garson bağını temizler. Migration sırasında eski açık assignment'lar güncel adisyon alanlarını doldurur; kapalı satırlar geçmiş olarak korunur.

## API

- `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks`: `requestId`, `firstOrderId`, `items` ve isteğe bağlı `customerId`, `tableId`, `waiterId` ile adisyonu ve ilk siparişi aynı transaction'da oluşturur.
- `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/orders`: var olan açık adisyona yeni `orderId` ve `items` ekler.
- `GET /api/v1/firms/{firmId}/branches/{branchId}/sales/checks`: son 100 adisyonu listeler.
- `GET /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}`: adisyon, sipariş/kalemler, toplanmış TRY tutarları ve ödeme girişimlerini döndürür.
- `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/payment-attempts`: gövdedeki `orderId` adisyana bağlı olmalı; ödeme girişimi mevcut simülatör durum makinesini kullanır.
- `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/checks/{checkId}/payment-attempts/{attemptId}/resolve`: adisyana ait bekleyen/belirsiz girişimi mevcut simülatör kurallarıyla sonuçlandırır.

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
- Backfill sonrası sipariş, ödeme, audit ve assignment satırlarının kimlik ve sayılarının korunduğunu doğrulama.
- Simüle ödemenin yalnız sales verisi üretmesi; kasa, cari veya muhasebe hareketi üretmemesi.
