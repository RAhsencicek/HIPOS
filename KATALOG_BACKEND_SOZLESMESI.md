# HIPOS — Ürünler ve Menü backend sözleşmesi

Durum: PostgreSQL liste/detay okuması, **şube bazlı ürün taslağı** ve **firma bazlı kategori oluşturma/ad değiştirme** komutları uygulandı. Panelin temel taslak formu API'ye bağlıdır; kategori yönetimi henüz panel formuna bağlanmadı. Fiyat, yayın ve diğer yazmalar hâlâ planlıdır. Yönetici paneli ilk kullanıcı yüzüdür; sipariş oluşturma veya POS işlemi bu sözleşmenin parçası değildir.

## Bugün çalışan okuma dilimi

Development ortamında, PostgreSQL ve `CatalogDbContext` migration'ı kurulmuşsa:

```text
GET /api/v1/firms/{firmId}/catalog/products
    ?branchId={branchId}&query={text}&categoryId={id}&page=1&pageSize=25
GET /api/v1/firms/{firmId}/catalog/products/{productId}?branchId={branchId}
GET /api/v1/firms/{firmId}/catalog/categories?branchId={branchId}
```

Yanıtlar mevcut frontend `CatalogProvider` biçimini izler. `branchId` yoksa yalnız **bütün şubelerine erişimi olan** demo aktör firma kataloğunu görür; bu durumda merkez fiyatı gösterilir. Şube seçilirse yalnız o şubeye görünür ürünler döner ve şube fiyat istisnası varsa o fiyat seçilir. Kategori listesi artık `catalog.categories` tablosundan gelir; `{scope, items: [{id, name, productCount, version, isActive, sortOrder}]}` döner. Firma kategorileri her şube görünümünde yer alır; `productCount` yalnız seçilen şubenin ürünlerini sayar ve sıfır olabilir. Ürün listesindeki kategori filtresi aynı şube kapsamını kullanır. Arama ürün adı/SKU üzerinde çalışır; ürün listesi sayfalıdır. Ürün başka firma veya seçili şube kapsamında değilse detay `404` döner. Yetkisiz kapsam `403`, girişsiz istek `401` döner.

Başlangıç veritabanı boş olabilir. Şema migration'ı deployment komutudur, modül aç/kapa düğmesi bunu çalıştırmaz. Katalog migration'ı eksikse API `CATALOG_STORAGE_UNAVAILABLE` ile `503` döner. `X-Demo-Actor` hâlâ yalnız yerel test kimliğidir; gerçek kullanıcı güvenliği değildir.

`catalog.products` genel prototip anahtarı için `effectiveForNewWork=false` kalır. Taslak komutları ayrı `catalog.drafts` anahtarına bağlıdır. Bu anahtar katalogda **`backend_preview`** etiketlidir: yalnız PostgreSQL şeması hazır, demo yönetici yetkili ve özellik ilgili şubede etkinse `effectiveForNewWork=true` olur; üretime hazır anlamına gelmez. Kapatma yeni taslak yazmasını durdurur, mevcut ürün okumasını kapatmaz. HTTP okuması `VITE_CATALOG_PROVIDER=http` ile seçilebilir; varsayılan ekran mock kalır.

## Bugün çalışan yönetsel taslak komutları

```text
POST /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts
Body: { draftId, name, sku, categoryId, categoryName, description }

PUT /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}
Body: { name, sku, categoryId, categoryName, description, expectedVersion }
```

`draftId` istemcinin ürettiği UUID'dir. İlk oluşturma `201`, değişmemiş aynı taslağın aynı içerikle hemen tekrar gönderilmesi `200` döner ve ikinci denetim kaydı üretmez. Kimlik başka içerik için kullanılırsa veya taslak daha sonra değiştirilmişse eski oluşturma gövdesi `409` çakışır; bu mekanizma genel amaçlı kalıcı bir idempotency-key sistemi değildir. Stok kodu firma içinde tektir. Güncelleme yalnız taslak sahibinin şubesinde yapılır; `expectedVersion` eskiyse `409`, başka şubenin taslağıysa `404` döner. Kaydedilen taslak ürün okuma modeline ve denetim kaydına aynı PostgreSQL işleminde yansır.

Modül kapatma ve taslak komutu aynı şube özellik satırını kilitler: eşzamanlı istekte komut ya kapanmadan önce bütünüyle kaydolur ya da kapanmış özelliği görüp reddedilir. Taslak oluşturma/güncelleme, kategori kaydını ve güncel adını sunucuda doğrular. Taslakta fiyat `0` ve kanal listesi boştur; bunlar yayınlanabilir fiyat veya gerçek satış uygunluğu anlamına gelmez. Bu dilimde yayımlanmış ürünler güncellenmez, taslak yayınlanmaz. Panel mock modunda “Ürün ekleme akışı” yalnız prototip açıklamasıdır; HTTP modunda form ancak gerçek API yanıtından sonra başarı gösterir.

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
| Ürünler, ürün ayrıntısı | Firma/şube ürün listesi, detay, arama | Taslak oluştur, taslak güncelle, pasifleştir | Liste/detay ve temel taslak oluştur/güncelle panel–API–PostgreSQL zincirinde var; pasifleştirme yok. |
| Kategoriler | Kategori listesi ve şube ürün sayısı | Kategori oluştur/ad değiştir/sırala | Okuma, oluşturma ve ad değiştirme API/PostgreSQL'de var. Panel henüz yazma formu içermez; sıralama ve pasifleştirme yok. |
| Seçenek grupları, alerjenler, görseller | Ürün ilişkileri | Bağla/çıkar, görsel yükle | Yalnız mevcut okuma alanları; dosya/ilişki komutu yok. |
| Menüler ve kompozisyon | Menü–kategori–ürün hiyerarşisi | Taslak menü düzenle | Planlandı. |
| Kanal/şube görünürlüğü | Ürün kapsamı | Taslak görünürlük değiştir | Şube görünürlüğü okunur; komut yok. |
| Fiyatlar ve sürümler | Merkez/şube fiyatı, geçerlilik | Fiyat taslağı, şube istisnası, sürüm oluştur | Bugün tek merkez + şube fiyatı okunur; fiyat geçmişi ve geçerlilik yok. |
| İleri tarihli fiyatlar | Zamanlanmış sürümler | Gelecek tarihli fiyat planla/iptal et | Planlandı. |
| Menü yayınlama ve geçmişi | Taslak/yayın sürümleri | Yayınla, geri al | Bugün yalnız kayıt üzerindeki `draft/published` etiketi okunur; gerçek yayın akışı ve geçmiş yok. |

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

Taslak formu gerçek API'ye bağlandı. Gerçek HIPOS hesabı/şube üyeliği pilot öncesi kapıdır. Ardından kategori/şube görünürlüğü yazma modeli, fiyat sürümü ve yayın gelir. Bugünkü dar taslak modeli bütün kataloğun son domain modeli ilan edilmez.
