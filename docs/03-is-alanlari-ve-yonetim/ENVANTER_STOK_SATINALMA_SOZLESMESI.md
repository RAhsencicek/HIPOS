# Envanter, stok ve satın alma temel sözleşmesi

> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu için:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim ve yol haritası için:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](../00-devir-rehberi/DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding için:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](../00-devir-rehberi/DEVIR_REHBERI.md)
> * **Tarihsel kararlar için:** [docs/05-gecmis-ve-arsiv/](../05-gecmis-ve-arsiv/)

---

### 📌 Gerçeklik ve Uygulama Durumu Özeti

| Alan / Özellik | Durum | Açıklama |
| :--- | :--- | :--- |
| **Reçete sürümü** | **Çalışıyor** | Ürün bazlı hammadde gramajları ve sürümleme kalıcıdır |
| **Stok hareketi** | **Çalışıyor** | `inventory.movements` manuel giriş/çıkış ve bakiye hesabı çalışır |
| **Sayım ve düzeltme** | **Çalışıyor** | Taslak sayım, fark analizi ve tekil düzeltme hareketi çalışır |
| **Satıştan otomatik tüketim** | **Yok** | Adisyon kapanışında reçete patlatıp stok düşme henüz bağlanmadı |
| **Satın alma / mal kabul** | **Çalışıyor** | Fiyatsız sipariş taslak/onayı tek teslimle mal kabule bağlanır; mal kabul stok+cari etkisi, eksik teslim düzeltmesi ve tedarikçiye iade kalıcıdır |
| **Fire kaydı** | **Çalışıyor** | Hammadde ve reçeteli ürün zayisi kalıcı, idempotent ve atomik `waste_loss` çıkışları oluşturur; gerçek şef PIN onayı yoktur |
| **Maliyet hesabı** | **Ertelendi** | Fiyatlandırma ve stok maliyeti ayrı modülde tasarlanacaktır; fire kaydını engellemez |

---

Durum: 8 Ekim 2026. Bu belge mevcut reçete/stok/sayım MVP'sinin üzerine gelecek uyumlu genişletmeyi ve bu dilimin sınırlarını tanımlar. Uygulama gerçek PostgreSQL sağlayıcısı açıkken `inventory` API'sini kullanır; mock sağlayıcı verisi her yerde örnek olarak etiketlenir. Genel tablo sahipliği ve modül bağımlılıkları için [Backend Mimarisi](../01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) esas alınır.

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
- Mal kabul taslağı stok veya cariyi değiştirmez. Onay, her satır için `receiving` stok hareketini ve belge toplamı kadar `supplier_debt` cari hareketini aynı veritabanı işlemi içinde oluşturur; tekrar edilen istek çift kayıt üretmez.
- Onaylı mal kabul doğrudan değiştirilmez. Fiziksel eksik teslim, özgün satıra bağlı ayrı düzeltme fişiyle kaydedilir; miktar stoktan `purchase_correction` hareketiyle, satır fiyat/KDV/iskonto oranına düşen tutar tedarikçi borcundan `adjustment_decrease` hareketiyle aynı işlemde düşer.
- Bir satırdaki düzeltmelerin toplamı kabul edilen miktarı aşamaz. Açık sayım veya yetersiz stok varsa düzeltme reddedilir. Düzeltme açıklaması, aktör ve özgün belge bağlantısı denetim izinde korunur.
- Tedarikçiye iade, depoya gerçekten alınmış ürünün sonradan geri gönderilmesidir. Özgün mal kabul satırına bağlı ayrı iade irsaliye numarası, tarih, miktar ve neden taşır; `supplier_return` stok çıkışıyla `adjustment_decrease` cari hareketi aynı işlemde oluşur.
- Eksik teslim ve iade miktarlarının toplamı özgün kabul miktarını aşamaz. İade irsaliye numarası şube içinde tektir; açık sayım veya yetersiz stok iadeyi engeller. Aynı istek kimliğinin tekrarı çift stok/cari hareketi üretmez.
- Fire/zayi kaydı hammadde, miktar, kontrollü neden türü ve açıklama taşır. Kayıt ile bağlı negatif `waste_loss` hareketi aynı işlemde oluşur; açık sayım ve yetersiz stok kaydı engeller. Aynı istek kimliğinin tekrarı çift stok düşümü üretmez.
- Fire kaydı mevcut demo yönetici aktörünü denetim izine yazar. Şef PIN doğrulaması gerçek auth bulunmadığı için bu dilimde uygulanmış gibi gösterilmez.
- Fire/zayi kaydı fiyat veya maliyet bilgisi gerektirmez. Daha önce eklenmiş maliyet alanları veri kaybı yaratmamak için şemada korunur; yeni fiyatlandırma/maliyet modülü kararı verilene kadar fire ekranında gösterilmez ve yeni kaydı engellemez.
- Reçeteli ürün zayisi kayıt anındaki en güncel reçete sürümünü, ürün adını, porsiyon sayısını ve bileşen miktarlarını snapshot alır. Bütün bileşenler aynı işlemde düşer; birim uyuşmazlığı veya tek bir hammaddede yetersiz stok varsa hiçbir hareket yazılmaz. Aynı istek kimliği ikinci düşüm üretmez.
- Satın alma siparişi fiyat taşımaz; tedarikçi, depo, sipariş numarası/tarihi ve hammadde miktarlarını taşır. Durumları `draft`, `approved`, `completed`dır. Onaylı sipariş yalnız aynı tedarikçi, depo, hammadde kümesi ve miktarlarla tek bir mal kabul taslağına bağlanabilir; kısmi/fazla teslim reddedilir. Gerçekleşen fiyat, iskonto ve KDV mal kabul belgesinde girilir.

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
| `GET/POST /waste?warehouseId=…` | Depo kapsamlı fire geçmişi ve gerekçeli fire çıkışı; `inventory.items`, yeterli stok, kapalı sayım ve idempotency gerektirir. |
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

Satın alma talebi (öneri havuzundan otomatik talep), şubeler arası depo transferi, barkod okutma, birim dönüşüm tablosu, satıştan otomatik stok tüketimi ve üretim emri bu dilimin dışındadır. Fire kaydında gerçek şef PIN onayı auth modülünü bekler; fiyatlandırma/maliyet ayrı modüle ertelenmiştir. `manual_in` yalnızca manuel envanter girişidir; mal kabul akışı ayrı `receiving` hareketi üretir.

## Mal kabul ve satın alma kalıcı dilimi (30 Ekim 2026)

- Mal kabul belgesi önce `draft` durumunda oluşturulur; taslak stok ve cari bakiyeyi değiştirmez.
- Satırlar miktar, hammadde birimi, KDV hariç birim fiyat, iskonto oranı ve KDV oranı snapshot'ını taşır. Parasal değerler kuruş, oranlar baz puan olarak saklanır; yuvarlama satır bazında yapılır.
- Satın alma siparişi (`purchase_orders`) fiyat içermez; tedarikçi, depo, sipariş numarası/tarihi ve hammadde miktarlarıyla `draft → approved → completed` akışında çalışır. Mal kabul formu onaylı bir siparişe bağlandığında tüm kalem ve miktarlar birebir aktarılır ve tedarikçi/depo kilitlenir; kısmi veya fazla teslimat `PURCHASE_ORDER_LINES_MISMATCH` ile engellenir. Mal kabul sayfasında sağ üstteki `+ Yeni Satın Alma Siparişi` modalı ile hızlı sipariş oluşturulup anında onaylanabilir.
- Mal kabul onayında kullanıcıya **Onay ve Ödeme Modalı** sunulur (`paymentMode`):
  1. `on_account` (Cariye Borç Olarak Yaz — Varsayılan): Stok girişleriyle (`receiving`) birlikte tedarikçinin cari hesabına tam tutar borç (`supplier_debt`) tek PostgreSQL transaction'ında işlenir.
  2. `immediate_cash` (Hemen Kasadan Nakit Öde): Kullanıcı şubedeki açık kasa vardiyalarını (`cash.shifts`) ve çekmecedeki güncel nakit bakiyelerini görerek tek veya birden çok kasadan parçalı nakit dağıtımı yapabilir. Onay anında stok girişi (`receiving`), tedarikçi borcu (`supplier_debt`), ilgili kasalardan nakit çıkışı (`cash.movements` tür `manual_out`, kategori `expense`) ve cari borcu kapatan tediye hareketi (`cari.movements` tür `supplier_payment`) aynı veritabanı transaction'ında atomik olarak kaydedilir. Kısmi ödeme yapıldığında kalan bakiye tedarikçinin cari hesabında borç kalır; kasadaki nakitten fazla çıkış `INSUFFICIENT_CASH` ile reddedilir.
- Açık depo sayımı varken mal kabul onayı `COUNT_IN_PROGRESS` ile reddedilir. Tekrarlanan aynı onay isteği yeni hareket üretmez (idempotent).
- Onaylanan belge değiştirilemez. Eksik teslim düzeltmesi (`purchase_correction` ve `adjustment_decrease`) ile depoya alınmış ürünün fiziken geri gönderilmesi (`supplier_return` ve `adjustment_decrease`) orijinal belge satırına bağlı ters kayıtlar olarak uygulanır ve panelde sunulur.
- Mobil responsive uyum: Mal kabul satırları ve mal kabul geçmişi tabloları mobil ekranlarda (`max-width: 700px`) taşma yapmayan, hammadde seçimini tam genişlikte açan, etiket ve değerleri hizalı kart düzeninde sunulur.
