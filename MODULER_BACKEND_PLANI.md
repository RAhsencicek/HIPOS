# HIPOS — Modüler backend uygulama planı

Durum: Öncelik kararı. İlk pilot hesap akışı kontrollü ve küçük tutulur. Ana geliştirme hedefi, yönetim panelindeki iş alanlarının backend'de tam, şube kapsamına duyarlı ve birbirleriyle tutarlı çalışmasıdır. Bu belge **tamamlanmış özellik listesi değildir**; uygulama ve kabul sırasıdır.

## 1. Ne demek istiyoruz?

“Modüler” iki şartı birlikte sağlamalı:

1. **Kod sınırı:** Katalog, satış, stok, mutfak, finans gibi alanların kendi verisi ve iş kuralları vardır. Bir modül diğerinin tablosunu gizlice değiştirmez; sözleşme/olay üzerinden konuşur. Başlangıçta tek ASP.NET Core uygulaması ve tek PostgreSQL kullanılabilir.
2. **İşletme tercihi:** Firma/şube bir yeteneği açıp kapatabilir. Bu tercih, yeni iş kabulünü etkiler; geçmiş kayıtları silmez ve migration çalıştırmaz. Bağımlılık, kurulum eksiği, sağlayıcı bekleme ve devam eden iş ayrı durumlar olarak kalır.

Bugünkü `.NET` prototipi ikinci şartın **durum ve tercih** kısmını doğruladı. `catalog.drafts`, `catalog.price_drafts`, `catalog.publishing`, geliştirme amaçlı `sales.pos_orders` ve `payments.simulator` kalıcı komutlara modül kapısıyla bağlandı; diğer prototip/planlı özelliklerde `effectiveForNewWork=false` kalır. Simüle ödeme gerçek tahsilat veya tamamlanmış kasa modülü anlamına gelmez.

## 2. İlk teknik boşluklar

- Backend'deki 18 özellik tanımı paneldeki çok sayıdaki alt işin tamamını temsil etmiyor. **Capability envanteri** ayrıntılandırılmalı: hangisi temel alan, hangisi ayrı aç/kapa yeteneği, hangisi sadece ekran/rapor?
- Modül tanımları paylaşılan katalogdan okunuyor; sonraki iş API sözleşmesi/tip üretimiyle ekran–backend davranışını da eşleştirmek.
- Ürün taslağı, fiyat sürümü, ilk POS yayını, test POS siparişi ve **simüle ödeme girişimi/sonucu** kalıcı komutlara bağlandı. Gerçek tahsilat, stok tüketimi, yeniden fiyatlandırma ve yeniden yayın komutları henüz yok.
- `setup_required`, `provider_pending` ve `draining` örnek durumlar. Gerçek kurulum/sağlayıcı/iş tamamlama sinyalleri ilgili modüller tarafından üretilmeli.
- Tekrarlanan katalog/satış/simüle ödeme komutları sınandı; modüller arası olay, geri alma ve rapor projeksiyonu henüz işletme verisi üzerinde doğrulanmadı.

## 3. Her capability için aynı sözleşme

Her yeni özelliği kodlamadan önce şu kayıt hazırlanır:

```text
Kalıcı anahtar ve sahibi olan modül
Yönetim ekranı ve yönetici/operasyon sınırı
Firma/marka/şube kapsamı
Okuma API'leri ve yeni iş komutları
Bağımlı capability'ler
Gerekli işletme kurulumu ve dış sağlayıcılar
Açılma, kapanma ve devam eden iş davranışı
Geçmiş veri/rapor erişimi
Yetki ve denetim kaydı
İşlem/olay sınırı, tekrarlanan istek kuralı
Boş/hata/kapalı/kurulum/sağlayıcı durumları
Otomatik kabul testleri
```

Bu sözleşme “bir kart ve toggle yaptık” ile “modül gerçekten çalışıyor” arasındaki farkı görünür kılar. Ana menü görünür kalabilir; alt yeteneğin gerçek işlemi yalnız backend etkinliği doğrulanınca açılır.

## 4. Modül sahipliği ve bağımlılık haritası

| Alan/modül | Sahip olduğu temel veri veya karar | Öncelikli ilişki | Bugünkü durum |
| --- | --- | --- | --- |
| Firma, marka, şube ve erişim | İşletme yapısı, kullanıcı üyeliği, kapsam | Bütün modüller | Demo kapsamı var; gerçek hesap/üyelik yok. |
| Modül yönetimi | Tanım, şube tercihi, yaşam döngüsü, denetim | Bütün yeni iş komutları | Tercih PostgreSQL'de doğrulandı; taslak komutuyla ilk atomik bağlantı kuruldu. |
| Ürün, menü ve fiyat | Ürün, kategori, seçenek, alerjen, kanal/şube görünürlüğü, fiyat sürümü, yayın | Satış, kampanya, reçete, merkez yayın | PostgreSQL okuması, panelde taslak/fiyat/ilk POS yayını, kategori API'si ve geçmiş okuması var; kategori panel yazması, tekrar yayın ve diğer işler planlı. |
| Şube ve masa | Şube durumu, masa tanımı, masa planı | Adisyon ve rapor | Yönetimde görsel/örnek veri. |
| Satış ve adisyon | Sipariş/adisyon yaşam döngüsü, kalem ve fiyat anlık görüntüsü | Menü, mutfak, ödeme, stok, rapor | Ayrı test POS'tan ilk kalıcı açık sipariş ve yöneticide HTTP salt okunur liste var; tam adisyon yaşam döngüsü yok. |
| Mutfak/KDS | İstasyon, iş sırası, hazırlık durumu | Satış, servis, rapor | Yönetimde izleme örneği; gerçek KDS işi yok. |
| Stok ve reçete | Hammadde, depo, hareket, reçete sürümü, maliyet | Menü, satış, satın alma, rapor | Yönetimde örnek ekran; gerçek stok hareketi yok. |
| Satın alma | Talep, onay, sipariş, mal kabul, tedarikçi | Stok, gider/borç | Planlı yönetsel akış. |
| Kasa ve ödeme | Tahsilat durumu, vardiya, mutabakat, iade | Satış, finans, rapor | Test girişimi/sonucu PostgreSQL'de; kısmi, bekleyen ve belirsiz durumlar doğrulandı. Gerçek sağlayıcı, tahsilat ve kasa yok. |
| Finans | Gider, borç/alacak, mali özet | Satın alma, kasa, rapor | Planlı. |
| Müşteri ve pazarlama | Müşteri, segment, izin, sadakat, kampanya | Satış, menü, rapor | Planlı. |
| Raporlama | Tanımlı satış/ödeme/stok projeksiyonları | Kaynak modüllerin olayları | Görsel prototip. |
| Entegrasyonlar | Bağlantı, sağlayıcı durumu, eşleme, hata | Satış, ödeme, menü, mali belge | Katalogda görünür; gerçek bağlantı yok. |
| Merkezi yönetim | Merkez tanımı, şubeye yayın, istisna, geri alma | Menü/fiyat/kampanya/şube | Görsel prototip. |

Bu liste uygulama sırasında alt capability'lere bölünecek. Örneğin “Stok ve Satın Alma” tek aç/kapa bayrağı değil; stok, reçete, sayım, transfer, satın alma ve mal kabulün ayrı kuralları olabilir. Kesin ayrım kullanıcı iş akışlarıyla kararlaştırılır.

## 5. Modüller nasıl birlikte çalışacak?

Örnek akışlar ve sahiplik sınırları:

- **Menü → satış:** Yayınlanan ürün ve fiyatın satış anındaki sürümü sipariş kalemine kaydedilir. Daha sonra fiyat değişmesi geçmiş satışın tutarını değiştirmez.
- **Satış → mutfak:** Kabul edilen sipariş, uygun istasyonda iş doğurur. Satış modülü KDS tablosunu doğrudan yazmaz; açık bir sözleşme/olay kullanır.
- **Satış → stok:** Stok tüketiminin hangi anda ve hangi reçete sürümüyle hesaplanacağı ayrıca ürün kararıdır. Bu karar verilmeden sahte stok düşümü yapılmaz.
- **Satış → ödeme → kapanış:** Belirsiz ödeme sonucu başarı sayılmaz; gerçekten doğrulanmış tahsilat olmadan adisyon kapanmaz. Tekrarlanan ödeme isteği çift tahsilat yaratmaz.
- **Kaynak modüller → rapor:** Raporlar satış, ödeme ve stok için kendi kafasına göre başka formül üretmez; tanımlı kaynak kayıt/olaylardan projeksiyon kurar.
- **Modül kapatma:** Yeni komut backend'de reddedilir. Devam eden işin güvenli bitişi ilgili modülün sorumluluğudur; geçmiş kayıt ve rapor okunabilir kalır.

Aynı işlemde kesin tutarlılık gereken adımlar tek veritabanı işlemiyle korunur. Sonradan/ayrı süreçte yapılabilecek yayılım için olay ve gerekirse outbox tasarlanır; olay, kaynak işlem kaydedilmeden “başarılı” ilan edilmez. İlk günden gereksiz mesaj altyapısı kurulmaz.

## 6. Uygulama sırası

### A. Ortak modül omurgası

1. Panel alt işleri ile backend capability'lerini eşleyen [ilk envanteri](OZELLIK_ENVANTERI.md) katalogdan başlayarak ayrıntılandır; prototip/planlı/gerçek etiketlerini doğrula.
2. Başlatılan ortak tanım kaynağını (`contracts/feature-catalog.v1.json`) ve API sözleşmesini sürümlendir; frontend/backend farklı anahtar veya bağımlılık kullanırsa test başarısız olsun.
3. Her gerçek komut için tek sunucu politikası belirle: kullanıcı/kapsam, modül etkinliği, kurulum, sürüm, idempotency ve denetim. Okuma ile yeni iş iznini ayrı tut.
4. PostgreSQL çok şubeli ve iki API örnekli yarış testlerini genişlet. Migration'ı deployment adımı olarak koru.

### B. İlk gerçek iş dilimi: Ürünler ve Menü

[Katalog backend dilimi](KATALOG_BACKEND_SOZLESMESI.md) ürün listesi/detayı, şube görünürlüğü, mevcut şube fiyatı ve yönetsel ürün taslağı oluşturma/güncellemeyi doğruladı. Firma kategorisi okuması ve sürümlü, denetimli oluşturma/ad değiştirme API'si hazır. Fiyat sürümü ve ilk POS yayını ayrı `catalog.price_drafts`/`catalog.publishing` anahtarlarıyla aç/kapa, şube, sürüm ve denetim kaydına bağlıdır; panel formları ve geçmiş görünümü çalışır. Sırada kategori panel yazması, şube/kanal görünürlüğü, yeniden fiyatlandırma ve yayın vardır. Bunlar tamamlanmadan bütün katalog “tamamlandı” sayılmaz.

### C. Bağımlı alanları sırayla bağlama

Şube ve merkezi yayın; stok/reçete ve satın alma; satış/adisyon ile mutfak izleme; ödeme/kasa/finans; müşteri/kampanya; raporlama ve entegrasyonlar. Sıra iş kuralı ve bağımlılık netleştikçe gözden geçirilir. Yönetim paneli ilk kullanıcı yüzü olmaya devam eder; gelecekteki operasyon yüzlerinin backend sözleşmesi düşünülür ama ekranları bu aşamada yapılmaz.

### D. Pilot güvenlik kapısı

Pilot işletme ve ilk sahibi HIPOS ekibi kontrollü açacak; halka açık firma kaydı yok. Gerçek kullanıcı/üyelik ve güvenli oturum üretime çıkmadan zorunludur. Bu çalışma modül omurgasını tasarlamayı durdurmaz; fakat `X-Demo-Actor` ile gerçek kullanıcıya hizmet verilmez. Google/Gmail girişi sonraya bırakılır.

## 7. “Tamamlandı” ölçütü

Bir modüle **gerçek** demek için: veri PostgreSQL'de sürümlü şemayla saklanmalı; firma/şube ve gerçek kullanıcı yetkisi sunucuda doğrulanmalı; okuma ve varsa yazma API'si çalışmalı; yeni iş modu kapalı/kurulumsuz/sağlayıcısızken engellenmeli; devam eden ve geçmiş iş davranışı tanımlanmalı; tekrar/çakışma güvenle ele alınmalı; denetim kaydı ve diğer modüllerle etkileşim test edilmeli; panel sahte başarı göstermemeli. Bunlardan biri yoksa etiket `prototip` veya `planlandı` kalır.

Bu kabul listesi bütün alanlar tamamlanana kadar tekrarlanır. “Hepsi birbiriyle uyumlu” iddiası, tek bir demo akışından değil modüller arası testlerden doğacaktır.
