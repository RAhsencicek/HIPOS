# Menü genel bakışı ve düzenleme

Tek şubeli yönetici `/admin/catalog/menus` sayfasında menülerini, şubede yayındaki menüyü ve bölüm/ürün sayılarını görür. Yeni menü oluşturur; mevcut menüde ad, açıklama, menüye özel başlıklar, ürünler ve sıralamayı düzenler. Önizleme güncel ürün adını ve şube fiyatını kullanır. Ürün kopyalanmaz, menüden çıkarma katalog ürününü silmez.

Menü bölümü, katalog kategorisiyle aynı şey değildir. Yönetici ister bir katalog kategorisini hazır bölüm olarak ekler, ister “Kahvaltı Favorileri” gibi menüye özel bir başlık açar. Sonra şubedeki mevcut ürünleri ürün adı veya katalog kategorisiyle arayıp farklı kategorilerden seçebilir. Menüdeki fiyat ve ürün bilgisi ortak katalog kaynağından gelir; menü düzenlemek ürün kartı ya da bağımsız fiyat oluşturmaz.

## Kalıcı sözleşme

- `catalog.menus`: UUID, firma, şube, ad, açıklama, şubede yayın/aktiflik durumu, sürüm, oluşturma/güncelleme zamanı. Şube başına en fazla bir yayındaki menü.
- `catalog.menu_sections`: menü, menüye özel başlık kimliği ve adı, sıra.
- `catalog.menu_items`: menü, özel başlık ve var olan katalog ürününün kimliği, sıra. Ürün aynı menüde bir kez bulunur.
- `catalog.menu_audit`: tekil requestId, firma/şube, menü, aktör, işlem, içerik parmak izi, sürüm, JSON anlık görüntüsü ve zaman.

API kökü: `/api/v1/firms/{firmId}/branches/{branchId}/catalog/menus`.

- GET kök: menüler ve tüm şube ürünleri/kategorilerinden oluşan düzenleyici sözlüğü; `source: postgres`.
- POST kök: `{ requestId, expectedVersion: 0, name, description, sections: [{ sectionId, name, productIds }] }`; requestId yeni menü kimliğidir. sectionId/name menü kapsamındadır, katalog kategorisi değildir.
- PUT `/{menuId}`: aynı gövde, pozitif expectedVersion. Sıralar dizideki konumdan türetilir.
- POST `/{menuId}/activation`: `{ requestId, expectedVersion, isActive }`. `isActive: true`, menüyü HIPOS içinde ilgili şubenin yayındaki menüsü yapar; diğer menü aynı işlemde yayından alınır ve denetlenir. Bu işlem POS'a veri göndermez, QR üretmez ve web sitesinde yayın yapmaz.

Her yazma `catalog.menus` capability satırını işlem içinde kilitler. Capability `catalog.products` bağımlılığına sahiptir. Kapanınca yeni kayıt, düzenleme ve aktiflik değişikliği durur; okuma ve geçmiş korunur. Migration modül düğmesiyle çalıştırılmaz.

Eski sürüm `409 VERSION_CONFLICT`, aynı requestId/farklı içerik `409 REQUEST_ID_CONFLICT`. Aynı isteğin tekrarı ikinci kayıt/denetim üretmez. Firma/şube sınırı, özel başlık adı, tekrar ürün ve yayınlanmamış ürün backend'de doğrulanır. Herhangi bir etkin katalog kategorisindeki mevcut şube ürünü, ürün kartı oluşturmadan menüye özel başlık altında gösterilebilir. Aynı ürün bir menüde iki kez kullanılamaz; başka menülerde yeniden kullanılabilir. Aktif menü en az bir ürüne sahip olmalı ve yalnız yayınlanmış, geçerli fiyatlı ürünleri içermelidir. Pasif taslak menü boş tutulabilir.

Şubede yayın; bu MVP'de menüyü ilgili HIPOS şubesinin seçili/yayındaki menüsü yapar. Yayın öncesinde her bölümde ürün bulunmalı; menüdeki ürünlerin tamamı katalogda yayınlanmış ve geçerli fiyatlı olmalıdır. QR/web yayını ileriki faza kaydedilmiştir; zamanlanmış yayın ve harici POS senkronizasyonu da henüz yoktur. Mevcut ürün/POS yayın akışı ve adisyon fiyat anlık görüntüleri değişmez. Menüye özel fiyat ve paket/kombo ürün bu dilimde yoktur.

## Kabul

Menü oluştur → özel başlık ekle → ikonlu ürün seçicisinde katalog kategorisini filtrele/ürün ara → farklı katalog kategorilerindeki ürünleri seç → sırala → etkileşimsiz menü görünümünde önizle → kaydet → yenile → kayıt korunur. Şubede yayına alma en fazla bir yayındaki menü bırakır. Bir menüden ürün çıkarma diğer menüyü ve katalog ürününü etkilemez. Modül kapalıyken GET çalışır, POST/PUT reddedilir. Eşzamanlı eski sürüm yazması reddedilir; tekrar istek çift kayıt üretmez.

Demo seed yerel PostgreSQL'de Ana Menü ve İçecek Menüsü oluşturur; var olan menü içeriğini değiştirmez. Kayıtlar kalıcıdır, içerik kurgusal restoran verisidir.

## Yerel çalıştırma ve test

`CatalogDbContext` için `20261009095315_AddMenuManagement` ve `20261009110219_AddMenuCustomSections` migration'ları uygulanır. İkinci migration eski menü başlıklarını ve ürün bağlarını koruyup başlık adını katalog kategorisinden doldurur. Katalog ürün seed'inden sonra `HIPOS_DEMO_DATABASE_URL` ile `npm run demo:seed:menus` çalıştırılır. İki menü başlangıçta pasiftir; yönetici aktif menüyü seçer. Firma/şube modül ayarlarında **Menü Yönetimi** açılır. Panel sağlayıcıları `VITE_CATALOG_PROVIDER=http` ve `VITE_FEATURE_PROVIDER=http` olmalıdır.

`npm run test:db` ayrı geçici PostgreSQL'de menü API ve React kabul testlerini de çalıştırır: yetkisiz kapsam, tekrarlanan ürün, yanlış kategori, yabancı firma ürünü, taslak ürünle aktifleştirme, tekrar istek, eski sürüm, eşzamanlı kaydetme, tek aktif menü, modül kapalı yazma yasağı, seed tekrarı, panelde seçim/sıralama/kaydetme/yenileme ve dar ekran yatay taşma kontrolü. Test verileri kullanıcının yerel veritabanına yazılmaz.

Elle kontrol: Menüler → Ana Menü → Düzenle → bölümde **Ürün seç** → kategori filtresinden ürün ekle/çıkar → sıralamayı değiştir → Kaydet → sayfayı yenile. Sonra **Şubede yayına al** → onayla → menülere dön. Ana kart “Şubede yayında” durumunu göstermeli. POS'a ürün yayını ayrı akıştır; QR/web bu fazda yapılmaz. Başka menüde aynı ürünü seçmek kopya ürün oluşturmamalı. Menü modülünü kapatınca kayıtlar görünmeli, yeni işlem düğmeleri kapalı kalmalı.
