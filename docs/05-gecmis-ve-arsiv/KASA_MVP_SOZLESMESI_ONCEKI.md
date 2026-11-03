> **Arşiv:** 30 Ekim 2026 öncesindeki çalışma kopyasıdır; güncel sözleşme için [ilgili belgeye](../02-kasa-ve-operasyon/KASA_MVP_SOZLESMESI.md) bakın. Aşağıdaki özgün metindeki göreli bağlantılar eski konumuna göredir.

# HIPOS — Tek Şube Kasa Yönetimi MVP Sözleşmesi

Durum: İlk yerel PostgreSQL/API/panel diliminin kabul sözleşmesi ve uygulama kaydı. Tarih: 13 Ekim 2026. Bu sözleşme yalnız **manuel kasa vardiyası ve nakit defteri** içindir; yeni nesil satış/POS ekranı değildir. API Production ortamında da başlatılabilir, ancak `X-Demo-Actor` taklit edilebilir ve gerçek kullanıcı kimliği olmadığı için bu dilim müşteri trafiğine güvenli değildir. Yeni kasa ürün hedefi [Kasa/POS Operasyon Sözleşmesi](KASA_POS_VE_OPERASYON_SOZLESMESI.md) içindedir.

Bu dilim, tek şubeli bir restoranın POS entegrasyonu olmadan kasa vardiyasını ve nakit hareketlerini kaydedebilmesini sağlar. Ürün **POS, banka bağlantısı, mali muhasebe veya e-belge sistemi değildir**. Bu sınır kullanıcı arayüzünde de açıkça belirtilmelidir.

## Ekran durumu ve renk sözleşmesi

Panelde alt ekranın sağ içerik alanında görünen durum etiketi ve rengi `apps/admin/src/data/featurePresentation.ts` tarafından belirlenir; yeni alt ekran eklenirken bu eşleme ve `featurePresentation.test.ts` birlikte güncellenmelidir. `VITE_CASH_PROVIDER=http` iken Kasa Özeti, Kasa Hareketleri, Kasa Vardiyaları ve Açılış / Kapanış `Çalışıyor` (yeşil) gösterilir; içerik PostgreSQL API'den gelir ve POS/kart tahsilatı sınırı açıklanır. Mock sağlayıcı açıkken bu operasyon ekranları `Gelecek planı` olarak kalır; mock kayıtlar gerçekmiş gibi sunulmaz. Yan menü yapısı değişmez; aynı kaynak eşlemesi kullanılır, çalışan/örnek ekranlar normal renkte, henüz etkin olmayan ve gelecek ekranlar kırmızı görünür. `contracts/feature-catalog.v1.json` içindeki `availability: backend_preview`, capability'nin modül kataloğundaki olgunluk seviyesidir; tek başına bir alt ekranın bu çalıştırmada etkin olduğunu belirtmez.

## Yönetici ihtiyacı ve kapsam

Yönetici bir kasiyer/işletme vardiyasını açarken başlangıç nakdini kaydeder; vardiya boyunca elle nakit giriş/çıkışlarını ve açıklamalarını ekler; kapanışta kasadaki fiziksel toplamı girip beklenen tutarla farkı görür. Hareketler silinemez veya yerinde değiştirilemez. Hatalı manuel hareket yalnızca `reversal` düzeltmesiyle dengelenir: aynı tutarda, ters yönde yeni defter hareketi oluşur; gerekçe ve orijinal hareket kimliği saklanır. Orijinal hareket değişmeden kalır ve bir defadan fazla düzeltilemez. `replace` bu sürümde desteklenmez.

İlk sürümde tek şube ve şube başına tek kayıtlı kasa vardır. Kasa kaydı yine `firmId`, `branchId` ve `registerId` taşır. `registerId` ileride aynı şubede birden fazla kasa tanımlamaya hazır kimliktir; ilk sürüm çoklu kasa yönetimi sunmaz.

Firma ve şube kaydı oluşturulduktan sonra onboarding akışı, çağrılabilir provisioning API'sini çalıştırarak `MAIN / Ana Kasa / manual` varsayılanını kurar. Bu depoda firma/şube oluşturma/onboarding orkestrasyonu henüz yoktur; dolayısıyla API kendiliğinden çağrılmaz. Provisioning `cash.management` capability'sini açmaz/kapatmaz ve uygulama başlangıcında tenant taraması yapmaz. Aynı firma/şube kilidi altında MAIN kontrol edilir: doğru özelliklerde etkin MAIN varsa mevcut kayıt döner; MAIN yok ama başka aktif kasa varsa `409 EXISTING_REGISTER`; MAIN yanlış ad/sağlayıcı/etkinlik durumundaysa `409 DEFAULT_REGISTER_CONFLICT`; hiç aktif kasa yoksa yeni varsayılan oluşturulur. Hiçbir mevcut kasa yeniden adlandırılmaz veya silinmez. Onboarding çağrısı manager kapsamı ister; firma/şube kapsamı sunucuda doğrulanır.

Gelecekteki onboarding orkestrasyonu şube kaydının kalıcı olmasından sonra provisioning'i çağırmalı, başarıyı onboarding adımına kaydetmeli ve hata halinde kullanıcıya “kurulum tamamlanmadı / yeniden dene” durumu sunmalıdır. Tekrar deneme aynı şube için güvenlidir. Bu provisioning uç noktası tek başına firma veya şube oluşturmaz.

İlk sürümün işlevleri:

- Kasa özeti ve açık vardiyanın ledger üzerinden hesaplanan beklenen nakdi.
- Vardiya açma ve açılış nakdini kayıt altına alma.
- Açık vardiyaya açıklamalı, pozitif tutarlı manuel nakit girişi/çıkışı ekleme. Giriş kategorileri günlük nakit satış toplamı/diğer; çıkış kategorileri gider/kasadan teslim/diğer olabilir. Bunlar fiş, fatura veya satış adisyonu değildir.
- Vardiya kapanışında fiziksel nakit toplamını alma; beklenen tutarı ve `fiziksel - beklenen` farkı gösterip saklama.
- Hatalı manuel giriş/çıkış için açık vardiyaya bağlı, aynı tutarlı ters hareket oluşturma; düzeltme geçmişini ve gerekçesini gösterme.
- Yeni şube için idempotent varsayılan kasa provisioning'i.
- Hareket ve vardiya geçmişini şube kapsamında okuma; aktör ve zaman denetimi.

İlk sürümde olmayanlar: POS'tan ödeme alma, kart/yemek kartı tahsilatı, sipariş/adisyon kapatma, otomatik satış toplamı, otomatik cari veya muhasebe kaydı, banka/POS mutabakatı, iade/karma ödeme, çoklu kasa, kasiyer yetkilendirmesi ve kupür bazlı sayım. Kurgusal ödeme simülatörü kasa hareketi üretmez.

## Capability ve modüler davranış

- Yeni operasyonel capability anahtarı: `cash.management`; firma/şube tercihi kapsamındadır ve `sales.monitoring` veya `payments.simulator` bağımlılığı yoktur.
- Var olan `cash.monitoring` anahtarı ve saklı tercihler bu dilimde silinmez. İşletme kayıtlarının sahibine dönüşmez; analitik/izleme kapsamı ayrıca ele alınır. Panel kasa operasyonlarını `cash.management` durumuna göre göstermelidir.
- Capability kapalıysa okuma ve geçmiş erişimi sürer; vardiya açma ve yeni hareket yazma reddedilir. Açık vardiya varsa, kasa kapatma ve sayım farkını kaydetme güvenli tamamlama işlemi olarak kabul edilir. Böylece kapatılan modül yeni nakit işlemi başlatmaz, fakat açık vardiyayı yarım bırakmaz.
- Capability kapalıyken düzeltme yeni bir defter hareketi olacağı için reddedilir. Onboarding provisioning'i kurulum işlemi olarak capability'den bağımsızdır; tercihi değiştirmez.
- Capability değişikliği migration çalıştırmaz, kayıt silmez ve satış/adisyon/personel gibi bağımsız modülleri kapatmaz.
- Kullanıcı/rol kimliği gerçek değildir. Development ortamında aynı şubedeki demo POS aktörü yalnız vardiya açma ve kapama işlemlerini de yapabilir; diğer kasa yazmaları yönetici aktörü gerektirir. Development dışındaki tüm kasa yazmaları yönetici aktörü gerektirir. Bu istisna gerçek kasiyer yetkilendirmesi değildir.

## Kalıcı veri sözleşmesi

Şema sahibi `cash` olur. Migration API başlatılırken otomatik uygulanmaz; diğer iş alanları gibi açık migration adımıdır.

| Tablo | İçerik / temel kurallar |
|---|---|
| `cash.registers` | `id`, `firm_id`, `branch_id`, şube içinde benzersiz `code`, ad, `provider_mode` (`manual` şimdi, `external_pos` gelecekte), etkinlik, sürüm. Onboarding varsayılanı `MAIN / Ana Kasa / manual` olur. |
| `cash.shifts` | `id`, firma/şube/kasa, `open/closed`, açan-kapayan aktör ve zaman, açılış hareket kimliği, beklenen/fiziksel/fark tutarı, kapanış `requestId`, sürüm. Kasa başına aynı anda en fazla bir açık vardiya; DB kısıtıyla korunur. |
| `cash.movements` | İstek kimliği, firma/şube/kasa/vardiya, `opening_float/manual_in/manual_out`, pozitif kuruş tutarı, TRY, kategori, açıklama, kaynak (`manual` şimdi; `pos` geleceğe ayrılmış), sağlayıcı/harici referans/sağlayıcı olay kimliği, düzeltme ise `original_movement_id`, `correction_type='reversal'`, zorunlu `correction_reason`, aktör ve zaman. Sağlayıcı olay kimliği firma/şube/sağlayıcı kapsamında tekildir. Satır değiştirilemez; aynı orijinal hareket için yalnız bir düzeltme olabilir. |
| `cash.audit` | Provisioning, açma/hareket/düzeltme/kapama işlemi, firma/şube/kasa/opsiyonel vardiya/hareket kimlikleri, aktör, eylem, istek kimliği, zaman ve özet. Şube seviyesindeki provisioning audit'i için `shift_id` nullable; audit ve operasyon kaydı aynı DB transaction'ında yazılır. |

Para `amountMinor` olarak pozitif tamsayı kuruş cinsinden tutulur; hareketin yönünü tür belirler. Sıfır/negatif tutar, geçersiz tür/kategori, kapalı veya başka kapsamlı kasa/vardiya kabul edilmez. Açılış nakdi de `opening_float` hareketidir; doğrudan bakiye alanı güncellenmez. Kapanış sayımı bir ledger hareketi değildir ve kapanış farkı kendiliğinden yeni hareket yaratmaz.

Her komut benzersiz UUID `requestId` taşır. Aynı istek ve aynı içerik tekrarlandığında ilk sonuç döner; aynı kimlik farklı içerikle kullanılırsa `409 IDEMPOTENCY_CONFLICT` olur. Yarışan açılışlar, aynı kasa satır kilidi ve DB unique constraint ile tekilleştirilir. Para hareketi, audit ve idempotency sonucu aynı transaction içinde yazılır.

### Düzeltme ve vardiya kuralları

- `POST /movements/{originalMovementId}/corrections` gövdesi `{ requestId, correctionType: "reversal", correctionReason }` olur. Tutar ve ters yön API tarafından orijinal manuel hareketten türetilir; istemci tutar/yön seçemez.
- Yalnız aynı firma/şube/kasadaki `manual_in` veya `manual_out` düzeltilebilir. `opening_float`, başka düzeltme ve ileride POS kaynaklı hareketler bu endpoint'ten düzeltilemez.
- Aynı kasada açık vardiya zorunludur. Orijinal hareket açık vardiyadaysa bile yeni ters hareket oluşturulur; orijinal satır güncellenmez. Orijinal vardiya kapalıysa ters hareket mevcut açık vardiyaya kaydedilir. Açık vardiya yoksa `409 OPEN_SHIFT_REQUIRED`; kapalı vardiya yeniden açılmaz/değiştirilmez.
- Orijinal `manual_in` için reversal bir `manual_out` olduğundan, mevcut vardiya nakdi yetmiyorsa `409 INSUFFICIENT_CASH` ile reddedilir; orijinal ve defter değişmeden kalır. `manual_out` reversal'ı aynı tutarlı `manual_in` olur.
- Gerekçe boş olamaz ve 3–500 karakterdir. Aynı `requestId` ve içerik tekrarı ilk sonucu döndürür. Farklı request ID ile aynı orijinal tekrar gönderilirse `409 MOVEMENT_ALREADY_CORRECTED` döner.
- Düzeltme satırı orijinali self-FK/composite scope ile referanslar; aynı orijinale tek düzeltme unique kısıtıyla korunur. Orijinal ve ters hareket için audit ayrı yazılır.
- Varsayılan kasa provisioning'i `PUT /registers/default` ile çağrılır; gövde `{ requestId }`. Boş şubede `MAIN / Ana Kasa / manual` oluşturup `201`, uyumlu MAIN tekrarında mevcut kaydı `200` döndürür. Aynı branch için transaction advisory lock eşzamanlı çağrıları tekilleştirir. Başka aktif kasa veya uyumsuz MAIN sessizce değiştirilmez; sırasıyla `409 EXISTING_REGISTER` ve `409 DEFAULT_REGISTER_CONFLICT` döner. İşlem kasa capability tercihini değiştirmez.

## API sözleşmesi

Kök: `/api/v1/firms/{firmId}/branches/{branchId}/cash`

| Method / route | Kullanım |
|---|---|
| `GET /overview` | Kasayı, açık vardiyayı, ledger'dan türetilen beklenen nakdi, bu vardiyanın giriş/çıkış toplamlarını ve en son hareketleri döndürür. Kaynak PostgreSQL'dir; başka modül bakiye hesaplamaz. |
| `GET /registers` | Şubedeki aktif kasa kayıtlarını listeler. İlk sürümde bir kayıt bulunur. |
| `GET /movements?shiftId=&from=&to=&page=&pageSize=` | Şube kapsamlı, sayfalı hareket geçmişi. Kapanmış vardiya hareketleri de okunur. |
| `GET /shifts?status=&from=&to=&page=&pageSize=` | Açık/kapalı vardiya geçmişi ve kayıtlı sayım/fark sonucu. |
| `PUT /registers/default` | Önceden oluşturulmuş firma/şubede idempotent varsayılan kasa provisioning'i. Yeni kayıt `201`, uyumlu mevcut MAIN `200`; başka aktif kasa `409 EXISTING_REGISTER`, uyumsuz MAIN `409 DEFAULT_REGISTER_CONFLICT`. Capability tercihini değiştirmez. |
| `POST /shifts` | `{ requestId, registerId, openingCashMinor, note? }`; isteğe bağlı açılış notu en fazla 500 karakterdir ve vardiyada saklanır. Capability açıkken vardiya ve `opening_float` atomik açılır. |
| `POST /shifts/{shiftId}/movements` | `{ requestId, kind: manual_in\|manual_out, amountMinor, category, description }`; açık vardiyaya manuel nakit kaydı ekler. |
| `POST /movements/{originalMovementId}/corrections` | `{ requestId, correctionType: "reversal", correctionReason }`; eş tutarlı ters hareketi yalnız aynı kasanın açık vardiyasına ekler. |
| `POST /shifts/{shiftId}/close` | `{ requestId, expectedVersion, countedCashMinor, note }`; anlık ledger beklenen tutarını kilit altında hesaplar, fiziksel sayım/farkı saklar ve vardiyayı kapatır. Aynı kapanış isteği tekrarında ikinci kayıt/hareket oluşmaz. Fark varsa açıklama zorunludur. |

Başarılı açma/hareket/kapama yanıtı işlem kimliği, `simulated: false`, `source: manual`, firma/şube/kasa, aktör, zaman ve saklanan sonucu içerir. Tarih aralığı ve sayfa sınırı backend'de doğrulanır. Hatalar mevcut API biçiminde `{ code, detail }` olur.

Beklenen temel hatalar: `FEATURE_DISABLED` (409), `CASH_STORAGE_UNAVAILABLE` (503), `REGISTER_NOT_FOUND` (404), `EXISTING_REGISTER` (409), `DEFAULT_REGISTER_CONFLICT` (409), `SHIFT_NOT_FOUND` (404), `SHIFT_ALREADY_OPEN` (409), `SHIFT_CLOSED` (409), `OPEN_SHIFT_REQUIRED` (409), `MOVEMENT_NOT_CORRECTABLE` (409), `MOVEMENT_ALREADY_CORRECTED` (409), `INVALID_CORRECTION` (400), `INSUFFICIENT_CASH` (409), `INVALID_CASH_AMOUNT` (400), `INVALID_CASH_MOVEMENT` (400), `VERSION_CONFLICT` (409), `IDEMPOTENCY_CONFLICT` (409), `CASH_DIFFERENCE_NOTE_REQUIRED` (400), `UNAUTHORIZED_SCOPE` (403), `UNAUTHENTICATED` (401).

## POS ve entegrasyon sınırı

İlk sürüm yalnız `source=manual` kabul eder. Gelecekteki sınır kararı: yalnız bağımsız, imzalı, kesinleşmiş `method=cash` provider olayı kasaya yansıtılabilir; ayrıştırılamayan karma olay bekler ve nakit hareketi oluşturmaz. İade, eski kaydı değiştirmeden orijinal olaya bağlı yeni telafi hareketi olmalıdır. İlk entegrasyon tek şube ve etkin `MAIN` kasa ile sınırlıdır. Ayrıntılar ve henüz netleşmemiş provider/outbox işletim kararları [ayrı taslakta](KASA_ONBOARDING_VE_SATIS_OLAY_SOZLESMESI.md) kayıtlıdır. `provider`, `externalReference` ve `providerEventId` alanları gelecekteki adaptörler için ayrılmıştır; olay API'si bugün etkin değildir. POS kart tahsilatı fiziksel nakit çekmecesine eklenmez. Harici POS API'si veya gerçek müşteri kurulumu henüz etkin değildir.

## Kabul senaryoları

1. Kapsamı doğru yönetici aktif demo kasasında 1.000,00 TL açılış yapar; tek açık vardiya ve tek açılış hareketi kalıcı olur. Aynı istek yinelenince ikinci vardiya oluşmaz.
2. Açık vardiyaya 250,00 TL nakit girişi ve 40,00 TL gider yazılır; API beklenen nakdi 1.210,00 TL hesaplar. Aynı `requestId` ikinci hareket yaratmaz; içerik değiştirilirse `409` verir.
3. Yönetici 1.200,00 TL sayar; API -10,00 TL farkı gösterir. Fark açıklaması olmadan kapanış reddedilir; açıklamayla kapanınca fark ve sayım kalıcıdır, fazladan nakit hareketi oluşmaz.
4. Kasa kapalıyken yeni hareket reddedilir; başka firma/şubenin kasası, vardiyası veya kaydı açığa çıkmaz.
5. `cash.management` kapalıyken okuma ve geçmiş sürer, yeni açılış/hareket reddedilir. Açık vardiya varsa yalnız onun güvenli kapanışı tamamlanabilir; modül tercihi bağımsız satış/adisyonu değiştirmez.
6. Aynı kasada yarışan iki açılış isteğinden yalnız biri açık vardiya oluşturur. Kapanış tekrarı ikinci kapatma/audit/movement üretmez.
7. `payments.simulator` içindeki succeeded cash/card testi `cash.movements` veya beklenen kasa tutarı oluşturmaz.
8. Demo seed'i mevcut tanıtım verisi olarak `KAD-01 / Kadıköy Ana Kasa` ve kurgusal vardiya/hareket geçmişini idempotent biçimde kurar. Yeni firma/şube onboarding'i ise ayrı provisioning API'sinden `MAIN / Ana Kasa` oluşturur. Seed, mevcut kullanıcı verisini yeniden adlandırmaz. API/panel HTTP provider kullanırken PostgreSQL kaynağını gösterir.
9. Aynı firma/şube provisioning çağrısı uyumlu MAIN kaydını döndürür; eşzamanlı/tekrarlı çağrılar ikinci kasa veya provisioning audit'i oluşturmaz. KAD-01 gibi başka aktif kasa varken `409 EXISTING_REGISTER`; yanlış özellikte MAIN varken `409 DEFAULT_REGISTER_CONFLICT` döner. Boş şubede yalnız bir MAIN oluşur. Başka firma/şube verisi görünmez; capability tercihi değişmez.
10. `manual_in` ve `manual_out` hatası tam ters yönde aynı tutarla yeni `reversal` üretir; orijinal değişmez. Gerekçe olmadan, kapalı vardiyaya, açılış/POS hareketine, başka kapsama veya ikinci kez düzeltme reddedilir.
11. Aynı düzeltme isteği ikinci hareket/audit oluşturmaz; farklı request ID ile aynı orijinalin tekrar düzeltmesi reddedilir. Orijinal vardiya kapalıysa ters hareket mevcut açık vardiyada olur; açık vardiya yoksa reddedilir.
12. Capability kapalıyken özet/register/movement/shift geçmişi okunur; yeni vardiya, normal hareket ve düzeltme reddedilir; önceden açık vardiya kapanabilir.
13. Simüle başarılı/bekleyen/belirsiz/iptal nakit/kart denemeleri öncesi ve sonrasında aynı kapsamda `cash.movements` ve `cari.movements` sayıları aynıdır.
14. Firma/şube dışından provisioning, düzeltme veya geçmiş okuma yetkisizdir; başka kapsamın kaydı yanıt/audit ile açığa çıkmaz.

## Durum ve sonraki dilimler

- **Tamamlandı ve test edildi:** append-only manuel reversal, idempotent varsayılan kasa provisioning'i, mevcut aktif kasa/uyumsuz MAIN koruması, capability değişmezliği, firma/şube kapsamı ve PostgreSQL kabul testleri.
- **Kasa MVP'si donduruldu:** yeni POS endpoint'i, otomatik satış-kasa hareketi, ödeme tahsilatı veya cari bağlantısı bu dilimde yapılmayacak.
- **Sıradaki sözleşme işi:** onboarding provisioning çağrı noktası ve hata/tekrar davranışını; ayrıca ilerideki doğrulanmış nakit POS olayının satıştan kasaya nasıl yansıyacağını belgelemek. Ayrıntı ve açık kararlar [Onboarding ve Satış–Kasa Olay Sözleşmesi Taslağı](KASA_ONBOARDING_VE_SATIS_OLAY_SOZLESMESI.md) içindedir.
- **Daha sonraki uygulama işi:** sözleşme kararları netleştikten sonra ayrı migration/API/idempotency/audit/izolasyon testli entegrasyon dilimi. Gerçek POS endpoint'i halen etkin değildir.
