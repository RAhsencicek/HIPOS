# Envanter, stok ve satın alma temel sözleşmesi

Durum: 8 Ekim 2026. Bu belge mevcut reçete/stok/sayım MVP'sinin üzerine gelecek uyumlu genişletmeyi ve bu dilimin sınırlarını tanımlar. Uygulama gerçek PostgreSQL sağlayıcısı açıkken `inventory` API'sini kullanır; mock sağlayıcı verisi her yerde örnek olarak etiketlenir. Genel tablo sahipliği ve modül bağımlılıkları için [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) esas alınır.

## İş kuralları

- Stok bakiyesi hiçbir zaman düzenlenebilir bir alan değildir; seçilen depodaki değiştirilemez hareketlerin toplamıdır.
- Kritik durum kesin olarak `onHand < criticalBelow` olur. Eşitlik kritik değildir. `criticalBelow` negatif olamaz ve yalnızca uyarı eşiğidir. `belowThresholdBy = max(criticalBelow - onHand, 0)` gösterilir.
- Hammadde kartında eşik düzenlenebilir. Birim yalnız izin verilen `g`, `kg`, `ml`, `l`, `adet` değerlerinden biri olabilir. Birim, o hammaddede hareket/reçete/sayım geçmişi varken değiştirilemez; eski miktarların anlamı bozulmaz. Eşik ve birim güncellemesi sürüm kontrollü ve denetim izlidir.
- İlk depo sabit kimlikli **Kadıköy Ana Depo**dur. Hammadde tanımı şube kapsamındadır; stok hareketi ve sayım depo kapsamındadır. Transfer ve satın alma belgesi bu dilimde yoktur.
- Reçeteden üretim hesabı her satırda `floor(onHand / recipeQuantity)` ve ürün için satırların en küçüğüdür. Değer `theoreticalPortions` olarak sunulur; üretim emri veya satılabilir garanti değildir. Fire, bozulma, başka ürünlerin tüketimi ve birim dönüşümü kapsanmaz. Reçete satırı birimi mevcut stok biriminden farklıysa tahmin `UNIT_MISMATCH` ile üretilmez.
- Her depo için en fazla bir taslak sayım olabilir. Taslak başlatılınca sistem miktarı, birim ve ilgili hammaddenin hareket adedi snapshot alınır. Taslak açıkken o depoya yeni stok hareketi ve yeni hammadde ekleme reddedilir. Fiziksel miktar kaydı stoğu değiştirmez; fark varsa satır `review_required` olarak işaretlenir.
- Onay öncesi sistem miktarı ve hareket adedi aynı kalmalıdır. Net bakiye değişmese bile yeni/ters hareket varsa `409 COUNT_STOCK_CHANGED` döner ve düzeltme yazılmaz. Onay tüm fiziksel miktarlar girildiğinde, uygun `inventory.counts` ve `inventory.items` modülleri açıkken yapılır; fark başına tek `count_adjustment` hareketi oluşur. Onay isteğinin tekrarı aynı sonucu verir.
- Taslak sayım modül kapatılmasına engeldir: `inventory.items` veya `inventory.counts` kapatma denemesi `409 INVENTORY_COUNT_OPEN` döndürür, açık sayım bitene kadar tercih etkin kalır. Taslağı iptal etme ayrı bir denetimli komuttur; snapshot ve audit korunur. Onaylı geçmişler her zaman okunabilir.
- Modül tercihi migration çalıştırmaz ve geçmiş kaydı silmez.

## PostgreSQL sahipliği

| Tablo | Sorumluluk | Temel alanlar |
| --- | --- | --- |
| `inventory.warehouses` | Şube içindeki fiziksel depo | `id`, `firm_id`, `branch_id`, `name`, `is_active`, `version`, timestamps |
| `inventory.ingredients` | Şube hammadde kartı ve uyarı eşiği | Mevcut alanlar; `critical_below >= 0`, izinli `unit`, concurrency `version` |
| `inventory.movements` | Değiştirilemez bakiye defteri | Mevcut kapsam + `warehouse_id`, `ingredient_id`, signed `delta`, snapshot `unit`, `kind`, `request id`, açıklama, aktör, zaman |
| `inventory.recipes` / `recipe_lines` | Ürün reçete sürümü ve satırlar | Ürün, sürüm, miktar ve satır birimi snapshot'ı |
| `inventory.counts` / `count_lines` | Depo sayım snapshot'ı, fiziksel değer ve onay | `warehouse_id`, durum/version/onay kimliği; satır sistem ve fiziksel miktar/birim ve hareket adedi snapshot'ı |
| `inventory.audit` | Hammadde, hareket, depo ve sayım eylemleri | Firma/şube/depo, entity, action, actor, açıklama, zaman |

Mevcut inventory satırları yeni migration'da sabit `warehouse-kadikoy-main` kimliğine bağlanır. Hareket birimi ve eski reçete/sayım satırı birimleri migration sırasında bağlı hammadde kartından kopyalanır. Hareket defteri ve onay kaydı silinmez/değiştirilmez.

## HTTP sözleşmesi

Temel yol: `/api/v1/firms/{firmId}/branches/{branchId}/inventory`. Tüm uçlar demo aktör tarafından firma/şube kapsamında doğrulanır. Yeni okumalar `{ source: "postgres" }` döndürür. `warehouseId` mevcut stok/sayım çağrılarında geriye uyumluluk için opsiyoneldir; tek depo varken sunucu Kadıköy Ana Depo'yu varsayılan seçer. İleride birden çok depo olduğunda belirsiz yazma reddedilir ve depo kimliği gerekir.

| Yöntem ve yol | Amaç / önemli sözleşme |
| --- | --- |
| `GET /warehouses` | Şubenin etkin depoları; ilk seed `Kadıköy Ana Depo`. |
| `GET /ingredients?warehouseId=…` | Hammadde kartları ve seçilen depoda hareketlerden hesaplanan `onHand`, `criticalBelow`, `belowThresholdBy`, `unit`, `isCritical`. |
| `POST /ingredients` | Hammadde kartı açma; `requestId`, isim, birim, sıfır veya pozitif kritik eşik. Aynı istek tekrarında tek kart. Açık sayım varken reddedilir. |
| `PUT /ingredients/{id}` | `requestId`, `expectedVersion`, `unit`, `criticalBelow`; destekli birim/eşik doğrulaması, idempotency ve audit. Kullanılmış birimin değişmesi reddedilir. |
| `GET /critical-stock?warehouseId=…` | Kaynak API'nin hesapladığı `criticalCount` ve kritik kalem listesi. Ana sayfa hesabı kopyalamaz. |
| `POST /movements` | `requestId`, `warehouseId?`, `ingredientId`, signed `delta`, `kind=manual_in\|manual_out`, `description`. Tenant/şube/depo, birim snapshot'ı, aktör/tarih ve audit saklanır. Negatif bakiye ve açık sayım reddedilir. |
| `GET /movements?warehouseId=…` | Depo kapsamlı geçmiş; imzalı miktar, birim, tür, açıklama, aktör ve zaman. |
| `GET /recipes` ve `GET /recipes/{productId}` | Kalıcı reçete sürümleri ve miktar/birim satırları. |
| `PUT /recipes/{productId}` | Yeni reçete sürümü; mevcut imzalı komut uyumlu kalır, birim API tarafından hammaddeden sabitlenir. |
| `GET /production-estimates?warehouseId=…` | Reçete başına teorik porsiyon sayısı, kısıtlayan hammadde ve satır kapasitesi; birim uyumsuzluğunda açık hata. |
| `GET/POST /counts?warehouseId=…` | Sayım geçmişi ve yeni depo snapshot'ı. Depoda açık taslak varsa ikinci taslak `409 COUNT_IN_PROGRESS`. |
| `PUT /counts/{id}/lines/{ingredientId}` | Sürüm kontrollü fiziksel miktar kaydı; `difference`, `review_required`/`matched`; stok hareketi oluşturmaz. |
| `POST /counts/{id}/approve` | Tam fiziksel sayım + iki modül açık + snapshot tutarlı koşullarında idempotent tekil düzeltme. Stok değişmişse `409 COUNT_STOCK_CHANGED`. |
| `POST /counts/{id}/cancel` | Açık taslağı `cancelled` yapar; snapshot/audit korunur ve kilit kalkar. Tekrar isteği idempotenttir. |

Modül tercihleri bağımsız kalır: `inventory.items`, `inventory.recipes`, `inventory.counts`. Hammadde/hareket yeni yazması `items`; reçete sürümü `recipes`; sayım başlatma/satır/onay/iptal `counts` gerektirir. Onay ayrıca stok ledger'ına yazdığı için `items` de ister. Geçmiş GET işlemleri modül kapalıyken açıktır.

## Panel ve doğrulama

- HTTP provider açıkken stok, kritik uyarı, reçete, teorik üretim ve sayım yalnız gerçek inventory API cevabından gösterilir. Mock provider ayrı ve görünür “Örnek gösterim” etiketi taşır.
- Ana sayfa kritik sayıyı ve kalemleri `GET /critical-stock` cevabından gösterir; eşik hesabını frontend'de tekrar etmez. Uyarı stok ekranına depo kapsamıyla bağlantı verir.
- Hammadde ekranında ad, mevcut miktar, kritik eşik, eşik altı miktar, birim ve durum görünür; eşik yönetici tarafından güncellenebilir.
- Sayım satırlarında sistem/fiziksel/fark/birim ve uyuşmazlık durumu görünür. “İnceleme gerekli” onay öncesi farkı belirtir.
- Reçete ekranı kapasiteyi **Teorik üretim** olarak etiketler; fire, bozulma, diğer tüketim ve birim dönüşümü uyarısını gösterir.
- Kabul seti geçici PostgreSQL API senaryoları ve gerçek API'ye bağlı Playwright panel senaryolarıdır. Migration sonrası yerel DB'de sabit seed sayıları ve Kadıköy depo kimliği SQL ile doğrulanır.

## Bu dilimin dışında

Satın alma siparişi/tedarikçi belgesi, cari borç oluşturma, mal kabulün tedarik siparişine bağlanması, depo transferi, barkod, birim dönüşüm tablosu, fire/bozulma kaydı, satıştan otomatik stok tüketimi ve üretim emri yoktur. `manual_in` yalnızca manuel envanter girişidir; satın alma veya ödeme belgesi değildir.
