# HIPOS — Yönetim paneli özellik envanteri (ilk geçiş)

Bu envanter, panelde görünen alanları capability tanımlarıyla karşılaştıran ilk geçiştir; yaşayan backend referansı değildir. Bir ekranın bir modül başlığı altında görünmesi, bütün işlemlerinin hazır olduğu anlamına gelmez. Güncel şema ve veri sahipliği [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md), ekran olgunluğu ise `apps/admin/src/data/featurePresentation.ts` içindedir. Kaynaklar: menü `apps/admin/src/data/catalog.ts`, route eşlemesi `apps/admin/src/app/routes.tsx`, ortak tanımlar `contracts/feature-catalog.v1.json`.

| Panel alanı | Bugünkü temsilî anahtar(lar) | Açık boşluk / karar |
| --- | --- | --- |
| Genel Bakış | `sales.monitoring`, `branches.tables` (özet okuma) | Yönetici başlangıç ekranı açık adisyon ve masa özetlerini API sağlayıcısı açıksa okur; mock modda örnek etiketi gösterir. Cari/ürün/stok için kısayol ve ürün duyurusu var. Bütün günlük metrikler henüz API'den hesaplanmıyor. |
| Şubeler ve Canlı Durum | `branches.tables`, `service.waiters`, `sales.monitoring` | Masa planı `service` PostgreSQL API'sine bağlıdır; masa/adisyon bağı personel kartından ayrı tutulur. Masa servisi kapanınca atama kapanır; `staff.records` kartları ve satış adisyonları açık kalabilir. Şube listesi/karşılaştırma ve genel durum hâlâ örnek gösterimdir. |
| Mutfak ve Servis | `staff.records`, `kitchen.monitoring` | Personel kartları `service.employees` PostgreSQL tablosunda bölüm/görev ve firma/şube kapsamıyla saklanır. Bordro, vardiya/puantaj ve POS yetkileri kapsam dışıdır. |
| Ürünler ve Menü | `catalog.products`, `catalog.drafts`, `catalog.price_drafts`, `catalog.publishing`, `catalog.pricing` | Ürün taslağı, fiyat sürümü ve ilk yayın PostgreSQL'de çalışır. Kategori panel yazması, seçenek, alerjen, görsel, kanal/şube görünürlüğü ve yeniden yayın henüz eksik. |
| Satışlar ve Adisyonlar | `sales.monitoring`, `sales.pos_orders` | Test POS'ta PostgreSQL siparişi, yönetimde HTTP salt okunur liste vardır. Adisyon masa olmadan oluşabilir. İptal, ikram, indirim, iade ve gerçek ödeme ayrı iş kurallarına ihtiyaç duyar; panel günlük operasyon komutu açmaz. |
| Cari ve Müşteriler | `customers.loyalty` yalnız sadakat/kupon kümesi için; ayrıca bağımsız cari API dilimi | Tek şubeli müşteri/tedarikçi kartları, düzenleme, manuel hareket ve İstanbul günlerine göre devir/dönem/kapanış ekstresi `VITE_CARI_PROVIDER=http` ile PostgreSQL'e bağlanır; varsayılan panel örnek gösterimdir. Finans ekranı bağlantısı, gerçek kimlik doğrulaması, iletişim/izin verisi henüz yok. |
| Kasalar | `cash.monitoring` | Kasa hareketi, vardiya, ödeme, iade ve mutabakat tek izleme anahtarına indirgenemez. Gerçek ödeme yok. |
| Giderler ve Finans | `finance.expenses` | Gider dışındaki borç/alacak, banka, vergi, belge ve muhasebe aktarımı bu anahtarla temsil edilemez. |
| Stok ve Satın Alma | `inventory.items`, `inventory.recipes`, `inventory.counts`, `procurement.requests` | Hammadde/eşik, depo kimliği, değiştirilemez stok defteri, teorik üretim tahmini ve snapshot/fiziksel/onaylı sayım API+PostgreSQL'e bağlı; `VITE_INVENTORY_PROVIDER=http` gerekir. İlk demo tek şube/tek depodur. Satın alma belgesi, fire, transfer, üretim emri, mal kabul ve maliyet henüz yoktur. |
| Mutfak ve Servis | `kitchen.monitoring` | Yönetici izlemesi ile gelecekteki KDS/servis komutları ayrı tutulmalı; istasyon, gecikme ve yazıcı durumu gerçek veriye bağlı değil. |
| Raporlar | `reports.sales`; sadakat ekranı `customers.loyalty` | Diğer raporlar için kaynak veri ve ortak metrik tanımı yok. Route varsayılanı tüm raporları satış raporu sayıyor. |
| Merkezi Yönetim | Yok | Marka/şube grubu, merkez yayın, istisna ve geri alma için firma/marka/şube sözleşmesi gerekiyor. |
| Ayarlar | `integrations.delivery` yalnız entegrasyon route'u | Kullanıcı/yetki, cihaz, vergi ve ödeme ayarları ayrı alanlar. Yemek platformu anahtarı tüm sağlayıcı türlerini kapsamaz. Modül kataloğu temel yönetim işidir. |

## İlk teknik sonuç

- **Modül tanımı ≠ menü kalemi.** 19 anahtarın 19 ekrana bire bir karşılığı yok; bazıları birden çok ekranın temsilî etiketi.
- Mevcut route eşlemesi bazı bölümlerde fazla geniş ve tamamlanmamış. Bu eşleme gerçek işlem yetkisi yerine geçemez. Backend'de her komutun sahibi ve gerektirdiği capability ayrıca belirlenmeli.
- Tanımlar `contracts/feature-catalog.v1.json` içinde. Frontend ve .NET sürüm 6'yı okur. `availability: prototype` veya `planned` olan hiçbir anahtar gerçek operasyonun hazır olduğunu iddia etmez; `backend_preview` yalnız geliştirme API'sini belirtir.
- Katalog, satış/test POS, cari, masa servisi ve temel envanter/reçete/sayım için PostgreSQL dilimleri vardır. Envanter satırı satın alma, satıştan otomatik tüketim veya barkodlu sayımın tamamlandığı anlamına gelmez; alan sahipliği ve sınırlar için [kanonik backend belgesine](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) bakın.
