# Menü genel bakışı ve düzenleme

Yönetici `/admin/catalog/menus` sayfasında menülerini, şubede POS'ta kullanılabilir menüleri ve bölüm/ürün sayılarını görür. Yeni menü oluşturur; mevcut menüde ad, açıklama, menüye özel başlıklar, ürünler ve sıralamayı düzenler. Önizleme güncel ürün adını ve şube fiyatını kullanır. Ürün kopyalanmaz, menüden çıkarma katalog ürününü silmez.

Menü bölümü, katalog kategorisiyle aynı şey değildir. Yönetici ister bir katalog kategorisini hazır bölüm olarak ekler, ister “Kahvaltı Favorileri” gibi menüye özel bir başlık açar. Sonra şubedeki mevcut ürünleri ürün adı veya katalog kategorisiyle arayıp farklı kategorilerden seçebilir. Menüdeki fiyat ve ürün bilgisi ortak katalog kaynağından gelir; menü düzenlemek ürün kartı ya da bağımsız fiyat oluşturmaz.

Garson ekranı aktif menü bölümlerine ek olarak aktif katalog kategorilerini ayrı bir görünümde sunar. Kategori görünümünde aktif, yayımlanmış, POS kanalına açık ve pozitif fiyatlı ürünler gösterilir; bunların bir menüye eklenmiş olması gerekmez.

## Kalıcı sözleşme

- `catalog.menus`: UUID, firma, şube, ad, açıklama, şubede yayın/aktiflik durumu, sürüm, oluşturma/güncelleme zamanı. Aynı şubede birden fazla menü aktif olabilir.
- `catalog.menu_sections`: menü, menüye özel başlık kimliği ve adı, sıra.
- `catalog.menu_items`: menü, özel başlık ve var olan katalog ürününün kimliği, sıra. Ürün aynı menüde bir kez bulunur.
- `catalog.menu_audit`: tekil requestId, firma/şube, menü, aktör, işlem, içerik parmak izi, sürüm, JSON anlık görüntüsü ve zaman.

API kökü: `/api/v1/firms/{firmId}/branches/{branchId}/catalog/menus`.

- GET kök: menüler ve tüm şube ürünleri/kategorilerinden oluşan düzenleyici sözlüğü; `source: postgres`.
- POST kök: `{ requestId, expectedVersion: 0, name, description, sections: [{ sectionId, name, productIds }] }`; requestId yeni menü kimliğidir. sectionId/name menü kapsamındadır, katalog kategorisi değildir.
- PUT `/{menuId}`: aynı gövde, pozitif expectedVersion. Sıralar dizideki konumdan türetilir.
- POST `/{menuId}/activation`: `{ requestId, expectedVersion, isActive }`. `isActive: true`, menüyü ilgili şubenin POS'ta kullanılabilir menülerine ekler. Aynı şubedeki diğer menülerin aktifliği değişmez. Tek QR bağlantısı ayrıca yapılandırılmışsa aynı şubedeki bütün aktif menüler QR'a açık ürünleriyle müşteri menüsünde gösterilir. Aktivasyon QR kodu üretmez.

Her yazma `catalog.menus` capability satırını işlem içinde kilitler. Capability `catalog.products` bağımlılığına sahiptir. Kapanınca yeni kayıt, düzenleme ve aktiflik değişikliği durur; okuma ve geçmiş korunur. Migration modül düğmesiyle çalıştırılmaz.

Eski sürüm `409 VERSION_CONFLICT`, aynı requestId/farklı içerik `409 REQUEST_ID_CONFLICT`. Aynı isteğin tekrarı ikinci kayıt/denetim üretmez. Firma/şube sınırı, özel başlık adı, tekrar ürün ve yayınlanmamış ürün backend'de doğrulanır. Herhangi bir etkin katalog kategorisindeki mevcut şube ürünü, ürün kartı oluşturmadan menüye özel başlık altında gösterilebilir. Aynı ürün bir menüde iki kez kullanılamaz; başka menülerde yeniden kullanılabilir. Aktif menü en az bir ürüne sahip olmalı; her bölümü dolu olmalı ve yalnız aktif, katalogda yayımlanmış, POS kanalında yayımlanmış ve geçerli fiyatlı ürünleri içermelidir. Pasif taslak menü boş tutulabilir.

Şubede etkinleştirme menüyü ilgili şubede POS'tan seçilebilir yapar; aynı şubede birden fazla menü etkinleştirilebilir. POS, aktif menü listesini katalog API'sinden alır. Etkinleştirme öncesinde her bölümde ürün bulunmalı; menüdeki ürünlerin tamamı aktif, katalogda yayımlanmış, POS kanalında yayımlanmış ve geçerli fiyatlı olmalıdır. Müşteri QR menüsünde şubenin aktif menüleri ve aktif katalog kategorileri ayrı keşif kartları olarak gösterilir. Kategori kartlarında yalnız aktif, katalogda yayımlanmış, QR tercihi açık ve geçerli fiyatlı ürünler listelenir; ürünün aktif menü bölümüne eklenmiş olması gerekmez. Menü kartları aktif menü bölümlerini gösterir. Ayrı QR yayın düğmesi, zamanlanmış menü yayını ve harici POS senkronizasyonu yoktur. Mevcut ürün/POS yayın akışı ve adisyon fiyat anlık görüntüleri değişmez. Menüye özel fiyat ve paket/kombo ürün bu dilimde yoktur.

## Müşteriye açık QR menüsü

Müşteri adresi `/menu/{token}`; yalnızca okuma API'si `GET /api/v1/public/menus/{token}` ve listelenebilir ürünler için herkese açık görsel adresi kullanır. Yönetim veya demo aktör başlığı gerekmez. Tek bağlantı seçili şubenin aktif menülerini, aktif katalog kategorilerini ve QR'a uygun ürünleri içerir. Yanıt ürün adı, açıklaması, alerjenleri, şube fiyatı ve uygun görselini içerir; yönetim kayıtlarını içermez. Bu akış sepet, sipariş, ödeme veya masa işlemi yapmaz.

API ortamında `HIPOS_PUBLIC_MENU__TOKEN`, `HIPOS_PUBLIC_MENU__FIRM_ID`, `HIPOS_PUBLIC_MENU__BRANCH_ID`, `HIPOS_PUBLIC_MENU__RESTAURANT_NAME` ve `HIPOS_PUBLIC_MENU__BRANCH_NAME` ayarlanmalıdır. İsteğe bağlı `HIPOS_PUBLIC_MENU__LOGO_URL` HTTPS veya aynı alan adındaki `/` ile başlayan yol olabilir. Token yalnız harf, rakam, `-`, `_` içermeli ve URL güvenli biçimde oluşturulmalıdır; herkese açık bağlantıdır, kimlik doğrulama yerine geçmez. Ayarlar eksikse veya token eşleşmezse menü açılmaz. Arayüzdeki isteğe bağlı `?masa=12` yalnızca bağlantıdan gelen etiketi gösterir; masa kimliği doğrulamaz ve hiçbir işleme bağlanmaz. Başka alan adında sunulan API için mevcut CORS köken ayarları ayrıca yapılmalıdır.

Logo adresi belirtilmemişse veya yüklenemezse mevcut HIPOS logosu gösterilir.

## Kabul

Menü oluştur → özel başlık ekle → ikonlu ürün seçicisinde katalog kategorisini filtrele/ürün ara → farklı katalog kategorilerindeki ürünleri seç → sırala → etkileşimsiz menü görünümünde önizle → kaydet → yenile → kayıt korunur. Aynı şubede iki menüyü etkinleştirince ikisi de POS'ta kullanılabilir kalır; birini pasifleştirmek diğer menüyü ve katalog ürününü etkilemez. Modül kapalıyken GET çalışır, POST/PUT reddedilir. Eşzamanlı eski sürüm yazması reddedilir; tekrar istek çift kayıt üretmez.

Demo seed yerel PostgreSQL'de Ana Menü ve İçecek Menüsü oluşturur; var olan menü içeriğini değiştirmez. Kayıtlar kalıcıdır, içerik kurgusal restoran verisidir.

## Yerel çalıştırma ve test

`CatalogDbContext` için `20261009095315_AddMenuManagement`, `20261009110219_AddMenuCustomSections` ve `20261027120000_AllowMultipleActiveMenus` migration'ları uygulanır. İkinci migration eski menü başlıklarını ve ürün bağlarını koruyup başlık adını katalog kategorisinden doldurur; son migration şube başına tek aktif menü kısıtını kaldırır. Katalog ürün seed'inden sonra `HIPOS_DEMO_DATABASE_URL` ile `npm run demo:seed:menus` çalıştırılır. İki menü başlangıçta pasiftir; yönetici POS'ta kullanıma uygun olanları etkinleştirebilir. Firma/şube modül ayarlarında **Menü Yönetimi** açılır. Panel sağlayıcıları `VITE_CATALOG_PROVIDER=http` ve `VITE_FEATURE_PROVIDER=http` olmalıdır.

`npm run test:db` ayrı geçici PostgreSQL'de menü API ve React kabul testlerini de çalıştırır: yetkisiz kapsam, tekrarlanan ürün, yanlış kategori, yabancı firma ürünü, taslak veya POS'ta yayımlanmamış ürünle aktifleştirme, tekrar istek, eski sürüm, eşzamanlı kaydetme, aynı şubede birden fazla aktif menü, modül kapalı yazma yasağı, seed tekrarı, panelde seçim/sıralama/kaydetme/yenileme ve dar ekran yatay taşma kontrolü. Test verileri kullanıcının yerel veritabanına yazılmaz.

Elle kontrol: Menüler → Ana Menü → Düzenle → bölümde **Ürün seç** → kategori filtresinden ürün ekle/çıkar → sıralamayı değiştir → Kaydet → sayfayı yenile. Sonra **Menüyü POS'ta kullanılabilir yap** → onayla; ardından Kahvaltı gibi ikinci bir menüyü de etkinleştir. İki menü de yönetim panelinde aktif kalmalı ve POS menü seçicisinde görünmelidir. POS'a ürün yayını ayrı akıştır; QR/web bu fazda yapılmaz. Başka menüde aynı ürünü seçmek kopya ürün oluşturmamalı. Menü modülünü kapatınca kayıtlar görünmeli, yeni işlem düğmeleri kapalı kalmalı.
