# HIPOS — Ürünler ve Menü backend sözleşmesi

Durum: PostgreSQL liste/detay okuması, **şube bazlı ürün taslağı**, **firma bazlı kategori oluşturma/ad değiştirme**, ilk **taslak fiyat sürümü → POS yayını** ve menü oluşturma/aktif menü komutları uygulandı. Ürün aktifliği, menü aktifliği ve kanal yayını ayrı durumlar olarak korunur. Seçenek gruplarının EF modeli, migration'ları, firma kapsamlı yönetim API'si ve sipariş oluşturma sırasında güncel katalogdan doğrulama/fiyat snapshot'ı uygulandı; panel ve garson ekranı entegrasyonu sıradadır. QR/web yayını, ileri tarihli/merkezi fiyat ve yayın geri alma planlıdır. Yönetim ve sipariş ekranlarının seçenek deneyimi henüz tamamlanmadı.

## Bugün çalışan okuma dilimi

Yerel geliştirme örneğinde, PostgreSQL ve `CatalogDbContext` migration'ı kurulmuşsa:

```text
GET /api/v1/firms/{firmId}/catalog/products
    ?branchId={branchId}&query={text}&categoryId={id}&page=1&pageSize=25
GET /api/v1/firms/{firmId}/catalog/products/{productId}?branchId={branchId}
GET /api/v1/firms/{firmId}/catalog/categories?branchId={branchId}
```

Yanıtlar mevcut frontend `CatalogProvider` biçimini izler. `branchId` yoksa yalnız **bütün şubelerine erişimi olan** demo aktör firma kataloğunu görür; bu durumda merkez fiyatı gösterilir. Şube seçilirse yalnız o şubeye görünür ürünler döner ve şube fiyat istisnası varsa o fiyat seçilir. Kategori listesi artık `catalog.categories` tablosundan gelir; `{scope, items: [{id, name, productCount, version, isActive, sortOrder}]}` döner. Firma kategorileri her şube görünümünde yer alır; `productCount` yalnız seçilen şubenin ürünlerini sayar ve sıfır olabilir. Ürün listesindeki kategori filtresi aynı şube kapsamını kullanır. Arama ürün adı/SKU üzerinde çalışır; ürün listesi sayfalıdır. Ürün başka firma veya seçili şube kapsamında değilse detay `404` döner. Yetkisiz kapsam `403`, girişsiz istek `401` döner.

Başlangıç veritabanı boş olabilir. Şema migration'ı deployment komutudur, modül aç/kapa düğmesi bunu çalıştırmaz. Katalog migration'ı eksikse API `CATALOG_STORAGE_UNAVAILABLE` ile `503` döner. `X-Demo-Actor` yerel geliştirme akışından gelir ama API route'ları bunu Development/Production ayrımı olmadan okuyabilir; başlık taklit edilebilir ve gerçek kullanıcı güvenliği sağlamaz.

`catalog.products` genel prototip anahtarı için `effectiveForNewWork=false` kalır. Taslak komutları ayrı `catalog.drafts` anahtarına bağlıdır. Bu anahtar katalogda **`backend_preview`** etiketlidir: yalnız PostgreSQL şeması hazır, demo yönetici yetkili ve özellik ilgili şubede etkinse `effectiveForNewWork=true` olur; üretime hazır anlamına gelmez. Kapatma yeni taslak yazmasını durdurur, mevcut ürün okumasını kapatmaz. HTTP okuması `VITE_CATALOG_PROVIDER=http` ile seçilebilir; varsayılan ekran mock kalır.

## Bugün çalışan yönetsel taslak komutları

```text
POST /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts
Body: { draftId, name, sku, categoryId, categoryName, description }

PUT /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}
Body: { name, sku, categoryId, categoryName, description, expectedVersion }
```

`draftId` istemcinin ürettiği UUID'dir. İlk oluşturma `201`, değişmemiş aynı taslağın aynı içerikle hemen tekrar gönderilmesi `200` döner ve ikinci denetim kaydı üretmez. Kimlik başka içerik için kullanılırsa veya taslak daha sonra değiştirilmişse eski oluşturma gövdesi `409` çakışır; bu mekanizma genel amaçlı kalıcı bir idempotency-key sistemi değildir. Stok kodu firma içinde tektir. Güncelleme yalnız taslak sahibinin şubesinde yapılır; `expectedVersion` eskiyse `409`, başka şubenin taslağıysa `404` döner. Kaydedilen taslak ürün okuma modeline ve denetim kaydına aynı PostgreSQL işleminde yansır.

Modül kapatma ve taslak komutu aynı şube özellik satırını kilitler: eşzamanlı istekte komut ya kapanmadan önce bütünüyle kaydolur ya da kapanmış özelliği görüp reddedilir. Taslak oluşturma/güncelleme, kategori kaydını ve güncel adını sunucuda doğrular. Yeni taslağın fiyatı `0`, kanal listesi boştur; fiyat sürümü ve yayın komutları tamamlanmadan satılabilir sayılmaz. Bu dilimde yayımlanmış ürünler güncellenmez. Panel mock modunda “Ürün ekleme akışı” yalnız prototip açıklamasıdır; HTTP modunda form ancak gerçek API yanıtından sonra başarı gösterir.

## Ürün, menü ve kanal durumları

Ürün durumu üç ayrı eksende değerlendirilir; tek bir alan diğerinin yerine geçmez:

| Kavram | Anlamı |
| --- | --- |
| Ürün `isActive` | Katalog kaydının yeni taslak/yayın/sipariş işlemlerinde kullanılabilir olup olmadığı. Pasife alınması ürünü veya geçmişini silmez. |
| Ürün `status` | `draft` veya `published`: ürünün katalog/POS yayın akışındaki olgunluk durumu. |
| Ürün `channels` ve `publications.channels` | Ürünün hangi kanala yayınlandığı. İlk MVP yalnız `pos` kanalını yazar; QR/web etkinmiş gibi gösterilmez. |
| Menü `isActive` | Seçili şubede kullanılabilir/aktif menü seçimi. Menü içerik kaydından ve tekil ürün aktifliğinden ayrıdır. |

Ürün API yanıtları `isActive` alanını taşır. Yeni ürün aktif olarak oluşturulur. Aktiflik değişikliği şu şube kapsamlı komutla yapılır:

```text
POST /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/activation
Body: { requestId, expectedVersion, isActive }
```

Komut firma/şube kapsamını, katalog yazma capability'sini, demo yönetici yetkisini ve sürümü sunucuda doğrular. Aynı `requestId` ve içerik tekrarlanırsa önceki sonuç döner; aynı kimlik farklı içerikle gelirse `409 REQUEST_ID_CONFLICT`, eski sürümle gelirse `409 VERSION_CONFLICT` döner. Durum ve audit satırı tek PostgreSQL işlemiyle yazılır. Migration mevcut ürünleri varsayılan olarak aktif korur. Ürün aktif/pasifliği değişirken `status`, `channels`, fiyat ve geçmiş yayın anlık görüntüleri değiştirilmez.

Pasif ürün:

- Yeni satış/adisyon sipariş kalemine eklenemez (`409 PRODUCT_INACTIVE`).
- Yeni POS yayın komutu reddedilir (`409 PRODUCT_INACTIVE`).
- Yeni menü aktif etme doğrulamasından geçemez. Menü içeriğindeki ürün bağlantısı silinmez; durum düzenleyicide görünür.
- Ürün daha önce aktif bir menüde bulunuyorsa ürünün pasife alınması o menüyü kendiliğinden pasifleştirmez veya içeriğini değiştirmez. Menü düzenleyicisinde ürün açıkça “Pasif ürün” olarak işaretlenir; sonraki aktivasyon denemesi sunucuda reddedilir.
- Açık adisyon satırları, siparişin ürün/fiyat anlık görüntüsü, eski yayınlar ve raporlama kaynakları değişmeden kalır.
- Ürün ve geçmişi silinmez. Ürün yeniden etkinleştirilirse yeni işlemlerde diğer `draft/published`, fiyat ve kanal kuralları uygulanır.

Pasif menü seçili şubede yeni kullanım/aktif seçim oluşturmaz. Menü içeriği, ürünler, önceki aktiflik audit anlık görüntüleri ve ürün yayın geçmişi korunur. Menü pasifleştirmek içindeki ürünleri pasifleştirmez; ürün pasifleştirmek de diğer menüleri veya ürünün bütün yayın geçmişini silmez.

Yayın geçmişi ürünün şube ve kanal bazlı değiştirilemez kayıtlarıdır. Ürünü veya menüyü pasife alma geçmiş yayın satırlarını fiziksel olarak silmez ya da geriye dönük değiştirmez. Ürün aktifliği, menü aktifliği veya kanal yayını UI'da tek bir “yayında” göstergesinde birleştirilmemelidir.

## Ürün aktifliği kabul sınırları

1. Aktif ve POS'a yayımlanmış ürünle açık adisyon oluşturulur.
2. Aynı ürünle aktif menü oluşturulur; ürün beklenen sürümle pasife alınır ve `isActive=false` olarak okunur.
3. Açık adisyon ve önceden aktif menü okunmaya devam eder; sipariş kalemi, tutar anlık görüntüsü, menü aktifliği ve ürün bağlantısı değişmez. Menü düzenleyicisinde “Pasif ürün” görünür.
4. Aynı ürünle yeni sipariş denemesi `409 PRODUCT_INACTIVE` alır; yeni sipariş oluşmaz.
5. Aynı ürünle yeni POS yayın isteği ve pasif ürünü içeren menünün yeni aktivasyonu reddedilir; eski yayın geçmişi ve menü içeriği korunur.
6. Tekrar kullanılan `requestId` ikinci durum değişikliği/audit oluşturmaz; farklı içerikte çakışır. Eski `expectedVersion` reddedilir.
7. Ürün pasifliği başka firma/şube kapsamındaki ürünü değiştiremez; menü pasifliği menü kompozisyonunu ve katalog ürünlerini silmez.
8. Kayıt, sürüm, audit, UI durumu ve firma/şube denetimleri migration'lı PostgreSQL kabul testinde doğrulanır.

## İlk fiyat sürümü ve POS yayını

```text
PUT /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}/price
Body: { priceVersionId, amountMinor, expectedVersion }

POST /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}/publish
Body: { publicationId, expectedVersion }

GET /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/price-versions
GET /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/publications
```

Yetkili yönetici aynı şubenin taslağına pozitif TRY fiyatı yazar; her değişiklik ayrı, numaralı ve değiştirilmeyen `price_versions` kaydıdır. `expectedVersion` eskiyse `409` döner. Fiyat kimliğiyle aynı tutarı tekrar göndermek ikinci sürüm üretmez. Yayın, son fiyat sürümünü ve ürünün ad/kategori/kod/fiyatını `publications` anlık görüntüsüne aynı işlemde kaydeder; ürünü yalnız `pos` kanalında `published` yapar, taslak yazma kaydını kaldırır. Geçerli fiyat yoksa yayın reddedilir. Yayın kimliğiyle tekrar aynı istek ikinci yayın yaratmaz. Denetim kaydı, ürün projeksiyonu ve yayın birlikte tamamlanır. `catalog.price_drafts` ve `catalog.publishing` bağımsız şube yetenekleridir; modül kapalıysa yeni komut işlemez, geçmiş fiyat/yayın kayıtları okunabilir.

Bu ilk dilim **tek şubeli taslaktan ilk POS yayınıdır**. Yayını güncelleme, geri alma, merkezi/çok şubeli fiyat, kanal seçimi ve ileri tarihli fiyat henüz yoktur. Daha önceki test fixture'ları `published` ürün taşıyabilir; yeni yayın akışının kanıtı panel → API → Test POS → yönetim tarayıcı testidir.

## Bugün çalışan firma kategorisi komutları

```text
POST /api/v1/firms/{firmId}/catalog/categories
Body: { id, name }

PUT /api/v1/firms/{firmId}/catalog/categories/{categoryId}
Body: { name, expectedVersion }
```

Kategori firma genelinde olduğu için komutu yalnız bütün firma şubelerine erişen yönetici verebilir. Şube yöneticisi veya salt okuma kullanıcısı `403` alır. Kategori oluşturma `201`, aynı kimlik/adla tekrar `200`, farklı adla tekrar `409` döner. Ad değiştirme eski sürümle `409 VERSION_CONFLICT` döner. Değişiklik kategori satırını, ilgili ürün/taslak okuma anlık görüntülerini, sürümlerini ve denetim kayıtlarını **tek veritabanı işleminde** günceller. Şube modülünü kapatmak kategori geçmişini silmez; firma sözlüğü yönetsel veri olarak kalır. Bu henüz üretim kimlik/yetki sistemi değildir: yetki geliştirme ortamındaki demo aktörlerle sınanır. Kategori sıralama, pasifleştirme ve panelden kategori yazma sonraki dilimlerdir.

## Ekran → veri ve komut ayrımı

| Alt ekran grubu | Okuma ihtiyacı | Gelecek yönetsel komut | Durum |
| --- | --- | --- | --- |
| Ürünler, ürün ayrıntısı | Firma/şube ürün listesi, detay, arama; aktiflik ve kanal/yayın durumu ayrı görünür | Taslak oluştur/güncelle, etkinleştir/pasifleştir | Ürün aktifliği, audit ve API korumaları panel/API/PostgreSQL kabul testinde doğrulandı; ürün yayın geçmişi okunabiliyor. |
| Kategoriler | Kategori listesi ve şube ürün sayısı | Kategori oluştur/ad değiştir/sırala | Okuma, oluşturma ve ad değiştirme API/PostgreSQL'de var. Panel henüz yazma formu içermez; sıralama ve pasifleştirme yok. |
| Seçenek grupları, alerjenler, görseller | Ürün ilişkileri | Bağla/çıkar, görsel yükle | Normalize grup API'si ve sipariş API'sinde doğrulama/fiyat snapshot'ı PostgreSQL'e bağlıdır; yönetim ve sipariş ekranı bağlı değildir. Alerjen/görsel komutu yoktur. |
| Menüler ve kompozisyon | Menü–kategori–ürün hiyerarşisi; menü aktifliği ürün durumundan ayrıdır | Taslak menü düzenle, şubede etkinleştir/pasifleştir | Menü düzenleme ve tek aktif menü seçimi panel/API/PostgreSQL'de vardır; etkinleştirme pasif ürün içeriyorsa reddedilir. |
| Kanal/şube görünürlüğü | Ürün kapsamı | Taslak görünürlük değiştir | Şube görünürlüğü okunur; komut yok. |
| Fiyatlar ve sürümler | Merkez/şube fiyatı, geçerlilik | Fiyat taslağı, şube istisnası, sürüm oluştur | Şube taslağı için numaralı fiyat sürümü API'si, panel formu ve geçmiş okuması var; ileri tarih/merkez istisnası yok. |
| İleri tarihli fiyatlar | Zamanlanmış sürümler | Gelecek tarihli fiyat planla/iptal et | Planlandı. |
| Menü yayınlama ve geçmişi | Taslak/yayın sürümleri | Yayınla, geri al | İlk taslak → POS yayını ve geçmişi panelden çalışır; geri alma ve tekrar yayın yok. |

## Ürün seçenekleri — yönetim ve sipariş API'si uygulanmış, ekran entegrasyonu bekliyor

EF modeli, migration, firma kapsamlı grup yönetimi API'si ve sipariş fiyatlama/snapshot entegrasyonu PostgreSQL'e uygulanmıştır. Aşağıdaki maddeler mevcut backend sözleşmesini açıklar; yönetim paneli ve garson ekranı henüz bu API'lere bağlı değildir.

### Veri modeli

- `catalog.option_groups` firma kapsamında tekrar kullanılabilir grupları tutar. Grup birden fazla ürüne bağlanabilir; ürün-grup bağı yoksa ürün için o grup seçeneği bulunmaz.
- `catalog.option_items` bir grubun seçeneklerini tutar. Her seçenek işaretli `price_delta_minor BIGINT` kullanır; TRY tutarları kuruş cinsindendir ve negatif fiyat farkı geçerlidir.
- `catalog.product_option_groups` ürün-grup bağını, ürün üzerindeki sıralamayı ve o ürün için `min_selections` / nullable `max_selections` sınırlarını tutar. Aynı grup farklı ürünlerde farklı seçim sınırlarıyla kullanılabilir.
- Grup sınırları farklı seçilmiş seçenek kimliklerini sayar; seçenek adetleri bu sayıya dahil değildir. Seçenek bazında `quantity_enabled` ve `max_quantity` bulunur. Adet girişi kapalı seçenek bir kez seçilir; açıksa seçilen adet en az 1 ve tanımlı üst sınırı aşmayacak biçimde doğrulanır.
- Pasif grup ve seçenek sipariş sırasında seçilebilir. `is_active` bu hedef akışta seçimi engellemez. Ürün aktifliği kuralı bundan ayrıdır: pasif ürün yeni siparişe eklenemez ve yeniden aktifleştirilene kadar mevcut `409 PRODUCT_INACTIVE` kuralı korunur.

Eski `catalog.products.option_groups` metin dizisi normalize grup ve seçeneklere dönüştürülmeyecek; eski değerlerin korunması gerekmiyor. Eski kod tüketicileri yeni ilişkilere geçirildikten sonra bu alanı kaldıran ileri migration yapılabilir. Uygulanmış migration dosyaları geriye dönük değiştirilmez.

### Grup yönetimi API'si

Firma çapında tekrar kullanılabilir grup tanımları mevcut kategori yönetimindeki firma yöneticisi ve firma erişimi denetimiyle korunur. Grup/seçenek kayıtları pasif olsa bile okuma yanıtlarında döner. `requestId` ile aynı içerik tekrarlanırsa önceki anlık yanıt döner; aynı kimlik farklı içerikle gelirse `409 REQUEST_ID_CONFLICT` döner. Grup sürümü seçenek ekleme/düzenleme işlemlerinde de ilerler; ürün-grup bağlantısı ürünün sürümünü ilerletir. Denetim snapshot'ları `catalog.option_management_audit` tablosuna yazılır.

```text
GET  /api/v1/firms/{firmId}/catalog/option-groups
POST /api/v1/firms/{firmId}/catalog/option-groups
PUT  /api/v1/firms/{firmId}/catalog/option-groups/{groupId}
POST /api/v1/firms/{firmId}/catalog/option-groups/{groupId}/items
PUT  /api/v1/firms/{firmId}/catalog/option-groups/{groupId}/items/{itemId}
GET  /api/v1/firms/{firmId}/catalog/products/{productId}/option-groups
PUT  /api/v1/firms/{firmId}/catalog/products/{productId}/option-groups
```

Grup oluşturma gövdesi `requestId`, `name`, `isActive`, `sortOrder` alır; `requestId` grup UUID'si olarak da kullanılır. Grup düzenleme bunlara `expectedVersion` ekler. Seçenek oluşturma `requestId`, `name`, `priceDeltaMinor`, `quantityEnabled`, `maxQuantity`, `isActive`, `sortOrder` ve grubun beklenen sürümünü alır; `requestId` seçenek UUID'sidir. Seçenek düzenleme gövdesi `expectedVersion` ile grubun mevcut sürümünü ister. Adet girişi kapalıysa `maxQuantity` tam 1 olmalıdır; fiyat farkı işaretli `BIGINT` olarak kabul edilir.

Ürün-grup PUT gövdesi `requestId`, ürünün `expectedVersion` değeri ve `{ groupId, minSelections, maxSelections, sortOrder }` listesi alır. Bu liste ürünün grup bağlantılarının tamamını değiştirir; listeden çıkarılan grup o üründen ayrılır. Grup aynı firmaya ait olmalı, aynı ürün için tekrarlanmamalı; alt sınır seçenek sayısını aşmamalıdır. Seçim sayımı farklı seçenekleri esas alır, seçenek adedini değil. Fiziksel grup/seçenek silme uç noktası bu API diliminde yoktur.

### Sipariş doğrulaması, fiyat ve anlık görüntü

Sipariş oluşturma sırasında sunucu seçilen grup ve seçenek kimliklerini güncel katalogdan çözer. Seçenek, ürünün bağlı olduğu gruba ait olmalı; grup sınırları, seçenek adedi ve seçenek üst sınırı sunucuda doğrulanmalıdır. İstemciden gelen ad veya fiyat, fiyat hesabının kaynağı değildir. Pasif ürün reddedilir; pasif grup/seçenek tek başına ret nedeni değildir.

Her ürün birimi için hesaplama:

```text
birim_fiyat = sipariş anındaki temel ürün fiyatı
            + Σ(seçenek sipariş anındaki birim fiyat farkı × seçilen seçenek adedi)
```

Hesaplanan ürün birim fiyatı sıfırın altındaysa sipariş reddedilir; sıfır kabul edilir. Kalem toplamı bu birim fiyatın sipariş edilen ürün adediyle çarpılmasıyla hesaplanır.

Sipariş kalemi temel ürün fiyatını ve hesaplanan nihai birim fiyatı ayırt edilebilir şekilde saklar. `options_json` sipariş anındaki grup/seçenek kimliklerini ve adlarını, seçenek adetlerini ve birim fiyat farklarını taşır. Katalogda sonradan yapılan ad, fiyat veya ilişki değişiklikleri mevcut sipariş kaleminin tutarını ve görüntüsünü değiştirmez. Sipariş seçenekleri yayımlanmış POS anlık görüntüsünden değil, sipariş anındaki güncel katalogdan doğrulanır; bu nedenle istemcide eski kalmış seçenek sunucu tarafından reddedilebilir.

Sipariş gövdesi seçenekler için `{ groupId, optionId, quantity }` kimliklerini taşır. Eski `{ groupName, optionName }` etiket girdisi fiyatlandırılmış seçenek kabul edilmez; istemcilerin bu girdiyi seçme kimlikleriyle değiştirmesi gerekir. Yanıtlarda sipariş anı snapshot'ı ad ve fiyat farkını içerir.

Sipariş API'si ve ortak satış/garson sipariş girişleri bu doğrulamayı kullanır. Katalog yönetim ekranı, garson ekranı ve QR menü geliştirmesi bu backend diliminin kapsamı değildir; mevcut istemcilerin seçenek gönderme biçimi ayrıca güncellenmelidir.

### Kategori ve şube kapsamı kararı

Ürün listesindeki kategori sekmeleri ve ayrı Kategoriler ekranı sağlayıcının döndürdüğü veriden oluşur. API artık kategori tablosunu kaynak alır. Tabloda firma/kod anahtarı, isteğe bağlı marka alanı, sıra ve sürüm alanları bulunur; eski ürünler migration sırasında taşınır. Aynı firma/kod için farklı ad varsa migration sessiz seçim yapmaz, hata verip durur.

Kategori firmaya aittir; marka bağı ileride isteğe bağlı eklenebilir. Bir kategorinin şubede görünmesi, o şubeye yayınlanan ürün kapsamından ayrıdır. Şube taslağı oluşturma yetkisi firma çapında kategori değiştirme yetkisi sayılmaz. Denetim ve sürüm çakışması geçici PostgreSQL testinde doğrulanır.

## Yazmaya geçmeden önce korunacak kurallar

1. Ürün/kategori/fiyat için veri sahipliği ve firma/şube sınırı backend'de net olmalı. Bugünkü `catalog.products` tablosu **okuma modeli**, `catalog.drafts` ilk dar yazma modelidir. Kategori adı ve şube ID dizisi gibi alanlar denormalizedir; bütün kataloğun son domain modeli sayılmamalı.
2. Yeni iş komutu gerçek kullanıcı kimliği, firma/şube üyeliği, yetki, ilgili capability'nin `effectiveForNewWork` durumu, kurulum ve bağımlılıkları **sunucuda** denetlemeli. `desiredEnabled=true` tek başına izin değildir.
3. Taslak/fiyat değişikliği `expectedVersion` ile çakışmayı yakalamalı; tekrar edilen komutun sonucu ve denetim kaydı belirlenmeli.
4. Yayın, şube/kanal kapsamı ve fiyat sürümünü atomik, doğrulanabilir bir anlık görüntüye bağlamalı. Geçmiş satış tutarı sonraki fiyat değişiminden etkilenmemeli.
5. Modül kapalıysa yeni taslak/yayın komutu engellenir; mevcut ürün ve yayın geçmişi okunabilir kalır. İşlem sırasında kapatmanın nasıl davranacağı ayrıca test edilir.
6. Frontend gerçek API başarısı gelmeden “kaydedildi/yayınlandı” demez. Boş, hata, yetkisiz, kapalı ve migration eksik durumları ayrı gösterilir.

## Sıradaki teknik dilim

Taslak, fiyat ve ilk yayın panelden gerçek API'ye bağlandı. Gerçek HIPOS hesabı/şube üyeliği pilot öncesi kapıdır. Sırada daha kapsamlı şube/kanal görünürlüğü, yeniden yayın/fiyatlandırma kuralları ve ödeme sözleşmesi var. Bugünkü dar model bütün kataloğun son domain modeli ilan edilmez.
