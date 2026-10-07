# HIPOS — Yönetim paneli özellik envanteri (ilk geçiş)

Bu envanter, panelde görünen alanları bugünkü 14 backend modül tanımıyla karşılaştırır; yalnız `catalog.drafts` dar kapsamlı gerçek yazma komutuna bağlıdır. Bir ekranın bir modül başlığı altında görünmesi, o ekranın bütün API/veritabanı işlemlerinin hazır olduğu anlamına gelmez. Kaynaklar: panel menüsü `apps/admin/src/data/catalog.ts`, mevcut route eşlemesi `apps/admin/src/app/routes.tsx`, ortak tanımlar `contracts/feature-catalog.v1.json`.

| Panel alanı | Bugünkü temsilî anahtar(lar) | Açık boşluk / karar |
| --- | --- | --- |
| Genel Bakış | Yok; temel panel görünümü | Kartların kaynak modülleri ve kapsamı ayrı veri sözleşmelerine bağlanmalı. |
| Şubeler ve Canlı Durum | `branches.tables`, `sales.monitoring` | Mevcut route varsayılanı şube listesi/karşılaştırmayı da masa özelliği sayıyor; şube yapısı ve canlı durum ayrıca modellenmeli. |
| Ürünler ve Menü | `catalog.products`, `catalog.drafts`, `catalog.pricing` | 14 alt ekran bu başlıklar altında; yalnız taslak oluştur/güncelle backend'de gerçek. Kategori, seçenek, alerjen, görsel, kanal/şube görünürlüğü, fiyat sürümü ve yayın ayrı backend kabiliyetleri/komutları olarak tanımlanmalı. |
| Satışlar ve Adisyonlar | `sales.monitoring` | Şu an yalnız yöneticiye salt okunur temsil. İptal, ikram, indirim, iade ve ödeme ayrı iş kurallarına ihtiyaç duyar; panel günlük operasyon komutu açmaz. |
| Cari ve Müşteriler | `customers.loyalty` yalnız sadakat/kupon kümesi için | Müşteri, cari, izin ve iletişim kayıtları için ayrı sahiplik ve kişisel veri sınırı gerekli; çoğu route şu an modül durumuna eşlenmiyor. |
| Kasalar | `cash.monitoring` | Kasa hareketi, vardiya, ödeme, iade ve mutabakat tek izleme anahtarına indirgenemez. Gerçek ödeme yok. |
| Giderler ve Finans | `finance.expenses` | Gider dışındaki borç/alacak, banka, vergi, belge ve muhasebe aktarımı bu anahtarla temsil edilemez. |
| Stok ve Satın Alma | `inventory.items`, `inventory.recipes`, `procurement.requests` | Sayım, fire, transfer, üretim, mal kabul, tedarikçi, maliyet ve depo kapsamları ayrı kurallara bölünmeli. Mevcut route varsayılanı fazla geniş. |
| Mutfak ve Servis | `kitchen.monitoring` | Yönetici izlemesi ile gelecekteki KDS/servis komutları ayrı tutulmalı; istasyon, gecikme ve yazıcı durumu gerçek veriye bağlı değil. |
| Raporlar | `reports.sales`; sadakat ekranı `customers.loyalty` | Diğer raporlar için kaynak veri ve ortak metrik tanımı yok. Route varsayılanı tüm raporları satış raporu sayıyor. |
| Merkezi Yönetim | Yok | Marka/şube grubu, merkez yayın, istisna ve geri alma için firma/marka/şube sözleşmesi gerekiyor. |
| Ayarlar | `integrations.delivery` yalnız entegrasyon route'u | Kullanıcı/yetki, cihaz, vergi ve ödeme ayarları ayrı alanlar. Yemek platformu anahtarı tüm sağlayıcı türlerini kapsamaz. Modül kataloğu temel yönetim işidir. |

## İlk teknik sonuç

- **Modül tanımı ≠ menü kalemi.** 14 anahtarın 14 ekrana bire bir karşılığı yok; bazıları birden çok ekranın temsilî etiketi.
- Mevcut route eşlemesi bazı bölümlerde fazla geniş ve tamamlanmamış. Bu eşleme gerçek işlem yetkisi yerine geçemez. Backend'de her komutun sahibi ve gerektirdiği capability ayrıca belirlenmeli.
- Tanımlar `contracts/feature-catalog.v1.json` içinde. Frontend ve .NET aynı katalog sürümünü okur; `catalog.drafts` eklenirken sürüm artırıldı. `availability: prototype` veya `planned` olan hiçbir anahtar gerçek operasyonun hazır olduğunu iddia etmez.
- Katalog için ilk PostgreSQL okuma ve taslak yazma dilimi kuruldu. Diğer alanların tam envanteri aynı yöntemle detaylandırılacaktır.
