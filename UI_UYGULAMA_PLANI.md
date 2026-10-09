# Yönetim Paneli — UI Sözleşmesi ve Uygulama Sırası

Durum: 5 Ekim 2026 tarihli UI kararları ve uygulama geçmişi. Aşamaların burada yazılması tek başına tamamlandığı anlamına gelmez. Güncel ekran/backend durumu için [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) ve [Durum/Yol Haritası](DURUM_VE_YOL_HARITASI.md) esas alınır; bu belge yaşayan ürün durum panosu değildir.

## 1. Değişmeyen sınır

| Frontend sorumluluğu | ASP.NET Core backend sorumluluğu |
| --- | --- |
| Ekran akışı, kullanıcı etkileşimi, formun temel alan doğrulaması, filtre ve görsel durum | Domain doğrulaması, yetki kararı, firma/şube veri izolasyonu, fiyat ve finansal hesaplama |
| Kapsamı ve etkilenebilecek şubeleri kullanıcıya açıkça göstermek | İstek kapsamını doğrulamak ve yalnız yetkili veriyi döndürmek |
| Sunucudan gelen modül durumunu açıklamak | Modülün yeni iş için fiilen kullanılabilir olup olmadığına karar vermek |
| Prototip akışının kayıt oluşturmadığını söylemek | Kalıcı kayıt, sürüm çakışması, idempotency ve denetim izi |

Frontend'deki gizleme veya pasifleştirme güvenlik sınırı değildir. Mock sağlayıcı backend kararlarını yalnızca tasarım senaryosu olarak taklit eder. Fiyat, ödeme, stok tüketimi veya yetki sonucu frontend'de hesaplanmaz.

## 2. Kapsam ve gezinme

- Veri hiyerarşisi: `firma → isteğe bağlı marka → şube`. Marka yoksa UI marka satırını gizler.
- Aktif firma ve şube üst çubukta görünür. Çok şubeli senaryoda `Tüm şubeler` yalnız toplu okuma/rapor görünümüdür.
- Şube veya fiyat etkileyen bir komut, etkilenen şubeleri açıkça seçmeden gönderilemez. İlk gerçek komutlar tek şube kapsamıyla başlar; toplu yayın ayrı onaylı akıştır.
- Şube değiştiğinde önceki şubeye ait detay, önbellek ve geçici seçim yeni şube verisiymiş gibi gösterilmez. Gerçek API de kapsamı ayrıca doğrular.
- Hedef URL sözleşmesinde aktif firma ve şube `firmId` ve `branchId` sorgu parametreleriyle açık taşınır; toplu okuma için `branchId=all` kullanılır. Giriş yapan kullanıcının erişebildiği firmalar API'den gelir, URL'deki değer yetki kanıtı sayılmaz. Bugünkü prototipte seçim yalnız uygulama belleğindedir; URL senkronizasyonu veri sağlayıcısı aşamasında uygulanır. Derin bağlantı, geri/ileri gezinme ve kapsam değişiminde tutarlılık kabul ölçütüdür.

Kanonik yollar:

```text
/admin
/admin/branches
/admin/catalog
/admin/catalog/products
/admin/catalog/products/:productId
/admin/sales
/admin/inventory
/admin/reports
/admin/settings/modules
```

Alt ekranlar aynı `/admin/{alan}/{ekran}` düzenini izler. `/` adresi `/admin` konumuna yönlenir. Mevcut prototip yolları korunurken yeni alanların route tanımları kademeli olarak bağımsızlaştırılır.

## 3. Durum sözlüğü

Birbirine karıştırılmayacak dört eksen vardır:

1. **Veri isteği:** `idle`, `loading`, `success`, `empty`, `error`, `unauthorized`.
2. **Ürün/kayıt yaşam döngüsü:** örneğin `draft`, `published`, `archived`. Bunlar API sözleşmesinden gelir.
3. **Özellik durumu:** `disabled`, `setup_required`, `provider_pending`, `ready`, `draining`. `desiredEnabled` ile `effectiveForNewWork` ayrıdır.
4. **Uygulama olgunluğu:** `real`, `prototype`, `planned`. Gerçek olmayan işlem hiçbir zaman kalıcı başarı mesajı vermez.

Boş liste hata değildir. Modülün kapalı olması yetkisizlik değildir. Prototipte seçili düğme gerçek backend'de etkinlik anlamına gelmez. Kullanıcı bu farkı her ilgili ekranda görebilmelidir.

## 4. Ürünler ve Menü için başlangıç modeli

- Ürün, firma kataloğunda tek kimlikle tanımlanır; ürün isteğe bağlı bir markaya bağlı olabilir.
- Ürünün şubelerde görünürlüğü ayrı yayın/kapsam bilgisidir. Birden fazla şubede kullanılan aynı pizza ayrı ürün kimliklerine kopyalanmaz.
- Merkez fiyatı, kanala ve şubeye göre olası istisnalar ayrı sözleşmeler olarak modellenir. Öncelik ve miras kuralları backend tasarımında kesinleşir; frontend hesaplayıp kendi kendine geçerli fiyat üretmez.
- Taslak/yayın, kanal görünürlüğü, alerjen, seçenek grubu ve reçete bağlantısı birbirinden ayrı bilgiler olarak gösterilir. Reçete ve stok bağlantıları uygulanmamışsa açıkça prototip/planlandı olarak işaretlenir.
- Yayınlama ileride sürümlü ve izlenebilir olur. İlk frontend yayın geçmişini gerçek kayıt varmış gibi sunmaz.
- Ürün oluşturma/düzenleme prototip akışı bittiğinde “Bu önizleme kalıcı kayıt oluşturmadı” açıklaması gösterir; başarı bildirimi veya sahte ID üretmez.

## 5. Uygulama aşamaları ve kabul ölçütleri

### Aşama 0 — UI sözleşmesi

Bu belgedeki kapsam, route, dört durum ekseni ve ürün kimliği kararı sabitlenir. [API ve Mock Veri Sözleşmesi](API_VE_MOCK_SOZLESMESI.md) ileride DTO'ların kaynak belgesidir. **Durum: bu belgeyle tamamlandı.**

### Aşama 1 — Mevcut prototipi alanlara ayırma

`app`, `layout`, `features`, `shared` ayrımı yapılır; görsel tasarım ve gezinme korunur. Eski `/` adresi çalışır. Tip denetimi ve üretim derlemesi geçer. **Durum: tamamlandı.** Bu aşama tek başına veri sağlayıcısı veya backend getirmez.

### Aşama 2 — Mock/API sağlayıcı sınırı

Sözleşme tipleri ekran fixture'larından ayrılır. **Tarihsel kayıt:** katalog sağlayıcı sınırı ve testleri bu aşamada tamamlandı; HTTP sağlayıcısı henüz yoktu. Sonraki dilimlerde katalog, satış, cari ve masa servisi için HTTP/PostgreSQL bağlantıları eklendi. Güncel modül/endpoint listesi [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) içindedir; bu eski aşama metnindeki “HTTP sağlayıcısı henüz yazılmadı” cümlesi artık geçerli değildir.

### Aşama 2B — Modül durumu ve aç/kapa sözleşmesi

`FeatureDefinition` ile şube bazlı `BranchFeatureState` ayrılır. `FeatureProvider` üzerinden okuma ve sürüm kontrollü tercih komutu çalışır. Mock; hazır, kapalı, kurulum gereken, sağlayıcı bekleyen, kapanmakta olan ve yetkisiz kapsamları örnekler. Kapalı modül geçmiş okumayı otomatik engellemez; yeni işlem önizlemesi pasif kalır. **Durum: frontend sözleşmesi, oturumluk mock, modül ekranı, route davranışı ve testler tamamlandı. İsteğe bağlı `HttpFeatureProvider` ile yerel .NET prototipi bağlandı; modül tercihleri isteğe bağlı PostgreSQL modunda kalıcıdır. Kapsam, sürüm, bağımlılık ve yeniden başlatma gerçek veritabanıyla doğrulandı. Gerçek kimlik doğrulaması ve işletme operasyonu henüz yok.**

### Aşama 3 — Ürünler ve Menü dikey dilimi

Ürün listesi, ayrıntı, kategori, seçenek, alerjen, kanal ve şube görünürlüğü, fiyat gösterimi, taslak/yayın ve yayın geçmişi davranışları ayrıntılandırılır. Merkez ürün ile şube istisnası UI'da ayrı görünür. Prototip işlemler kayıt oluşturmuyor açıklamasını taşır. Liste filtreleri ve URL/geri-ileri davranışı tutarlıdır.

### Aşama 4 — Diğer yönetim alanları

Stok, satış izleme, şube durumu, rapor, kampanya ve merkezi yönetim aynı ekran/durum kalıbıyla ilerler. Günlük operasyon eylemleri yönetim paneline eklenmez. Kampanyaların nihai navigasyon konumu, kendi ekranları tasarlanırken belirlenir.

### Aşama 5 — Otomatik doğrulama ve gerçek API hazırlığı

Route yönlendirmesi, kapsam değişimi, şube izolasyonu, kapalı modül, boş/hata ve “sahte kayıt yok” akışları otomatik test edilir. Katalog diliminin kapsam/durum/sahte kayıt testleri Aşama 2 ile birlikte eklendi; diğer alanların testleri kendi uygulama aşamalarında eklenir. API sözleşmesi backend ile sürümlenir; .NET modüler monolit aynı domain sınırlarını uygular.

## 6. Bu belgenin tarihsel kapsam notu

Bu kararlar gerçek ödeme, satıştan stok tüketimi, üretim, yetki sistemi veya sağlayıcı entegrasyonunun hazır olduğu anlamına gelmez. Katalog, satış/test POS, cari, masa servisi ve temel stok/reçete/sayım PostgreSQL dilimleri vardır. Envanter paneli `VITE_INVENTORY_PROVIDER=http` ile gerçek API'ye bağlanır; mock varsayılandır. Güncel bağımlılık, kapsam ve veri sahipliği için [kanonik backend belgesine](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md), elle deneme adımları için [stok test rehberine](STOK_REÇETE_SAYIM_MANUEL_TEST.md) bakın.
