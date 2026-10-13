# HIPOS — Tek Şube Kasa Yönetimi MVP Sözleşmesi

Durum: İlk yerel PostgreSQL/API/panel diliminin kabul sözleşmesi ve uygulama kaydı. Tarih: 13 Ekim 2026. Bu önizleme gerçek müşteri üretim kurulumu değildir; API yalnız Development'ta çalışır.

Bu dilim, tek şubeli bir restoranın POS entegrasyonu olmadan kasa vardiyasını ve nakit hareketlerini kaydedebilmesini sağlar. Ürün **POS, banka bağlantısı, mali muhasebe veya e-belge sistemi değildir**. Bu sınır kullanıcı arayüzünde de açıkça belirtilmelidir.

## Ekran durumu ve renk sözleşmesi

Panelde alt ekranın sağ içerik alanında görünen durum etiketi ve rengi `apps/admin/src/data/featurePresentation.ts` tarafından belirlenir; yeni alt ekran eklenirken bu eşleme ve `featurePresentation.test.ts` birlikte güncellenmelidir. `VITE_CASH_PROVIDER=http` iken Kasa Özeti, Kasa Hareketleri, Kasa Vardiyaları ve Açılış / Kapanış `Çalışıyor` (yeşil) gösterilir; içerik PostgreSQL API'den gelir ve POS/kart tahsilatı sınırı açıklanır. Mock sağlayıcı açıkken bu operasyon ekranları `Gelecek planı` olarak kalır; mock kayıtlar gerçekmiş gibi sunulmaz. `contracts/feature-catalog.v1.json` içindeki `availability: backend_preview`, capability'nin modül kataloğundaki olgunluk seviyesidir; tek başına bir alt ekranın bu çalıştırmada etkin olduğunu belirtmez. Sol menü yapısı ve renk kuralı bu dilimde değiştirilmez.

## Yönetici ihtiyacı ve kapsam

Yönetici bir kasiyer/işletme vardiyasını açarken başlangıç nakdini kaydeder; vardiya boyunca elle nakit giriş/çıkışlarını ve açıklamalarını ekler; kapanışta kasadaki fiziksel toplamı girip beklenen tutarla farkı görür. Hareketler silinemez veya yerinde değiştirilemez. Yanlış kayıt, yeni karşı yönlü ve açıklamalı manuel hareketle dengelenebilir; bu MVP'de otomatik hareket bağı/tersleme zinciri yoktur.

İlk sürümde tek şube ve şube başına tek kayıtlı kasa vardır. Kasa kaydı yine `firmId`, `branchId` ve `registerId` taşır. `registerId` ileride aynı şubede birden fazla kasa tanımlamaya hazır kimliktir; ilk sürüm çoklu kasa yönetimi sunmaz.

İlk sürümün işlevleri:

- Kasa özeti ve açık vardiyanın ledger üzerinden hesaplanan beklenen nakdi.
- Vardiya açma ve açılış nakdini kayıt altına alma.
- Açık vardiyaya açıklamalı, pozitif tutarlı manuel nakit girişi/çıkışı ekleme. Giriş kategorileri günlük nakit satış toplamı/diğer; çıkış kategorileri gider/kasadan teslim/diğer olabilir. Bunlar fiş, fatura veya satış adisyonu değildir.
- Vardiya kapanışında fiziksel nakit toplamını alma; beklenen tutarı ve `fiziksel - beklenen` farkı gösterip saklama.
- Hareket ve vardiya geçmişini şube kapsamında okuma; aktör ve zaman denetimi.

İlk sürümde olmayanlar: POS'tan ödeme alma, kart/yemek kartı tahsilatı, sipariş/adisyon kapatma, otomatik satış toplamı, otomatik cari veya muhasebe kaydı, banka/POS mutabakatı, iade/karma ödeme, çoklu kasa, kasiyer yetkilendirmesi ve kupür bazlı sayım. Kurgusal ödeme simülatörü kasa hareketi üretmez.

## Capability ve modüler davranış

- Yeni operasyonel capability anahtarı: `cash.management`; firma/şube tercihi kapsamındadır ve `sales.monitoring` veya `payments.simulator` bağımlılığı yoktur.
- Var olan `cash.monitoring` anahtarı ve saklı tercihler bu dilimde silinmez. İşletme kayıtlarının sahibine dönüşmez; analitik/izleme kapsamı ayrıca ele alınır. Panel kasa operasyonlarını `cash.management` durumuna göre göstermelidir.
- Capability kapalıysa okuma ve geçmiş erişimi sürer; vardiya açma ve yeni hareket yazma reddedilir. Açık vardiya varsa, kasa kapatma ve sayım farkını kaydetme güvenli tamamlama işlemi olarak kabul edilir. Böylece kapatılan modül yeni nakit işlemi başlatmaz, fakat açık vardiyayı yarım bırakmaz.
- Capability değişikliği migration çalıştırmaz, kayıt silmez ve satış/adisyon/personel gibi bağımsız modülleri kapatmaz.
- İlk sürümde kullanıcı/rol kimliği gerçek değildir. Yazma endpoint'leri bugünkü geliştirme erişim politikasındaki yönetici aktör şartını kullanır; üretim yetkilendirmesi olarak sunulmaz.

## Kalıcı veri sözleşmesi

Şema sahibi `cash` olur. Migration API başlatılırken otomatik uygulanmaz; diğer iş alanları gibi açık migration adımıdır.

| Tablo | İçerik / temel kurallar |
|---|---|
| `cash.registers` | `id`, `firm_id`, `branch_id`, şube içinde benzersiz `code`, ad, `provider_mode` (`manual` şimdi, `external_pos` gelecekte), etkinlik, sürüm. İlk demo kaydı şubenin tek kasasıdır. |
| `cash.shifts` | `id`, firma/şube/kasa, `open/closed`, açan-kapayan aktör ve zaman, açılış hareket kimliği, beklenen/fiziksel/fark tutarı, kapanış `requestId`, sürüm. Kasa başına aynı anda en fazla bir açık vardiya; DB kısıtıyla korunur. |
| `cash.movements` | İstek kimliği, firma/şube/kasa/vardiya, `opening_float/manual_in/manual_out`, pozitif kuruş tutarı, TRY, kategori, açıklama, kaynak (`manual` şimdi; `pos` geleceğe ayrılmış), sağlayıcı/harici referans/sağlayıcı olay kimliği, aktör ve zaman. Sağlayıcı olay kimliği firma/şube/sağlayıcı kapsamında tekildir. Satır değiştirilemez; beklenen bakiye bu kayıtların işaretli toplamından hesaplanır. |
| `cash.audit` | Oluşturma/açma/kapama işlemi, firma/şube/kasa/vardiya/hareket kimlikleri, aktör, eylem, istek kimliği, zaman ve gerekli eski/yeni özet. Operasyon kaydıyla aynı DB transaction içinde yazılır. |

Para `amountMinor` olarak pozitif tamsayı kuruş cinsinden tutulur; hareketin yönünü tür belirler. Sıfır/negatif tutar, geçersiz tür/kategori, kapalı veya başka kapsamlı kasa/vardiya kabul edilmez. Açılış nakdi de `opening_float` hareketidir; doğrudan bakiye alanı güncellenmez. Kapanış sayımı bir ledger hareketi değildir ve kapanış farkı kendiliğinden yeni hareket yaratmaz.

Her komut benzersiz UUID `requestId` taşır. Aynı istek ve aynı içerik tekrarlandığında ilk sonuç döner; aynı kimlik farklı içerikle kullanılırsa `409 IDEMPOTENCY_CONFLICT` olur. Yarışan açılışlar, aynı kasa satır kilidi ve DB unique constraint ile tekilleştirilir. Para hareketi, audit ve idempotency sonucu aynı transaction içinde yazılır.

## API sözleşmesi

Kök: `/api/v1/firms/{firmId}/branches/{branchId}/cash`

| Method / route | Kullanım |
|---|---|
| `GET /overview` | Kasayı, açık vardiyayı, ledger'dan türetilen beklenen nakdi, bu vardiyanın giriş/çıkış toplamlarını ve en son hareketleri döndürür. Kaynak PostgreSQL'dir; başka modül bakiye hesaplamaz. |
| `GET /registers` | Şubedeki aktif kasa kayıtlarını listeler. İlk sürümde bir kayıt bulunur. |
| `GET /movements?shiftId=&from=&to=&page=&pageSize=` | Şube kapsamlı, sayfalı hareket geçmişi. Kapanmış vardiya hareketleri de okunur. |
| `GET /shifts?status=&from=&to=&page=&pageSize=` | Açık/kapalı vardiya geçmişi ve kayıtlı sayım/fark sonucu. |
| `POST /shifts` | `{ requestId, registerId, openingCashMinor }`; capability açıkken vardiya ve `opening_float` atomik açılır. |
| `POST /shifts/{shiftId}/movements` | `{ requestId, kind: manual_in\|manual_out, amountMinor, category, description }`; açık vardiyaya manuel nakit kaydı ekler. |
| `POST /shifts/{shiftId}/close` | `{ requestId, expectedVersion, countedCashMinor, note }`; anlık ledger beklenen tutarını kilit altında hesaplar, fiziksel sayım/farkı saklar ve vardiyayı kapatır. Aynı kapanış isteği tekrarında ikinci kayıt/hareket oluşmaz. Fark varsa açıklama zorunludur. |

Başarılı açma/hareket/kapama yanıtı işlem kimliği, `simulated: false`, `source: manual`, firma/şube/kasa, aktör, zaman ve saklanan sonucu içerir. Tarih aralığı ve sayfa sınırı backend'de doğrulanır. Hatalar mevcut API biçiminde `{ code, detail }` olur.

Beklenen temel hatalar: `FEATURE_DISABLED` (409), `CASH_STORAGE_UNAVAILABLE` (503), `REGISTER_NOT_FOUND` (404), `SHIFT_NOT_FOUND` (404), `SHIFT_ALREADY_OPEN` (409), `SHIFT_CLOSED` (409), `INSUFFICIENT_CASH` (409), `INVALID_CASH_AMOUNT` (400), `INVALID_CASH_MOVEMENT` (400), `VERSION_CONFLICT` (409), `IDEMPOTENCY_CONFLICT` (409), `CASH_DIFFERENCE_NOTE_REQUIRED` (400), `UNAUTHORIZED_SCOPE` (403), `UNAUTHENTICATED` (401).

## POS ve entegrasyon sınırı

İlk sürüm yalnız `source=manual` kabul eder. Entegrasyon geldiğinde POS adaptörü doğrulanmış ödeme olayını sağlayıcı kimlikli ve tekrar işlemeye dayanıklı bir girişten geçirir; `provider`, `externalReference` ve sağlayıcı olay kimliği için kalıcı alan/tekillik sınırı hazırdır. POS kart tahsilatını fiziksel nakit çekmecesine eklemez. Gerçek nakit satışın hangi anda kasa movement'ına dönüştüğü ve iade/iptal telafisi o entegrasyon diliminin sözleşmesidir; test ödeme girişimleri geriye dönük kasa kaydı üretmez. Harici POS API'si veya gerçek müşteri kurulumu henüz etkin değildir.

## Kabul senaryoları

1. Kapsamı doğru yönetici aktif demo kasasında 1.000,00 TL açılış yapar; tek açık vardiya ve tek açılış hareketi kalıcı olur. Aynı istek yinelenince ikinci vardiya oluşmaz.
2. Açık vardiyaya 250,00 TL nakit girişi ve 40,00 TL gider yazılır; API beklenen nakdi 1.210,00 TL hesaplar. Aynı `requestId` ikinci hareket yaratmaz; içerik değiştirilirse `409` verir.
3. Yönetici 1.200,00 TL sayar; API -10,00 TL farkı gösterir. Fark açıklaması olmadan kapanış reddedilir; açıklamayla kapanınca fark ve sayım kalıcıdır, fazladan nakit hareketi oluşmaz.
4. Kasa kapalıyken yeni hareket reddedilir; başka firma/şubenin kasası, vardiyası veya kaydı açığa çıkmaz.
5. `cash.management` kapalıyken okuma ve geçmiş sürer, yeni açılış/hareket reddedilir. Açık vardiya varsa yalnız onun güvenli kapanışı tamamlanabilir; modül tercihi bağımsız satış/adisyonu değiştirmez.
6. Aynı kasada yarışan iki açılış isteğinden yalnız biri açık vardiya oluşturur. Kapanış tekrarı ikinci kapatma/audit/movement üretmez.
7. `payments.simulator` içindeki succeeded cash/card testi `cash.movements` veya beklenen kasa tutarı oluşturmaz.
8. Demo seed'i aynı şubeye tek kasayı ve gerçekçi, kurgusal vardiya/hareket geçmişini idempotent biçimde kurar. API/panel gerçek HTTP provider kullanırken açık `Örnek gösterim` etiketi olmadan bu PostgreSQL kaynağını gösterir.

## Uygulama sırası

1. Bu belgeyi veri/API/modül kabul sözleşmesi olarak sabitle.
2. `cash` EF Core context ve migration; test DB'de constraint ve transaction davranışını doğrula.
3. API command/query, audit, idempotency, kapsam ve `cash.management` kapısını ekle; PostgreSQL kabul senaryolarını çalıştır.
4. Demo sözleşmesi/seed'e kasayı ve geçmişi ekle; API restart ve tekrar seed testini doğrula.
5. Kasa alt ekranlarını gerçek HTTP API'ye bağla; açma → hareket → sayım/fark → kapama → geçmiş akışını browser testiyle doğrula.
6. Dokümantasyon ve capability kataloğunu gerçekleşen davranışla eşleştir. POS entegrasyonu, raporlar ve üretim kimlik/rol sistemi sonraki ayrı dilimlerdir.
