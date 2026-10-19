# HIPOS — Bugünkü durum ve sonraki yol

Durum tarihi: 19 Ekim 2026. Bu belge çalışan kodla ürün hedefini ayırır. Backend bağımlılıkları ve şema sahipliği [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md), sonraki işler [Mühendis Devir Rehberi](DEVIR_REHBERI.md) içindedir. Eski tek şube → cari → stok planı [İlk Üç Aşama](ILK_UC_ASAMA.md) tarihsel öncelik kaydıdır.

**Ürün yönü güncellemesi (19 Ekim 2026):** Bu belgenin ilk kapsamı yalnız yönetim paneliydi. Koordinasyon kararıyla HIPOS artık gerçek restoran operasyonunda kullanılacak kasa/POS, garson ve mutfak iş akışlarını da hedefliyor; internet kesilince LAN ve yerel sunucuda ortak çalışma, internet dönünce merkezi eşitleme gereksinimi vardır. Bu yeni hedef henüz tamamlanmış özellik değildir. Hedef ve ekip devri için [Devir Rehberi](DEVIR_REHBERI.md), operasyon için [Kasa/POS sözleşmesi](KASA_POS_VE_OPERASYON_SOZLESMESI.md), offline için [Senkronizasyon sözleşmesi](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md) esas alınır. Aşağıdaki eski bölümler tarihli mevcut durum envanteri olarak okunmalıdır.

## 1. Ürün hedefi

HIPOS gerçek restoranın yönetim ve günlük operasyonlarını aynı firma/şube verisi üzerinde desteklemeyi hedefler. Yönetim paneli ürün, fiyat, çalışan, masa ve ayarları yönetir; garson, kasa ve mutfak yüzleri sipariş ve servis işlerini yürütür. İnternet kesildiğinde yerel sunucu/LAN üzerinden ortak çalışma ve internet geldiğinde merkezi veritabanına eşitleme ürün gereksinimidir; henüz uygulanmamıştır. Ürün hedefi [devir rehberindedir](DEVIR_REHBERI.md).

Modülerlik iki ayrı konudur: kodun iş alanlarına ayrılması (**modüler monolit**) ve bir şubenin bir özelliği kullanmak istemesi (**özellik tercihi**). İkincisi kod veya tablo silmez; geçmiş veriye erişimi otomatik kapatmaz.

## 2. Gerçekten yapılmış olanlar

| Alan | Bugünkü durum |
| --- | --- |
| Yönetici başlangıç ekranı | Tek şube yöneticisi için sade işletme özeti, ürün/cari/stok/modül kısayolları ve ürün duyuruları vardır. Açık adisyon/masa özeti API sağlayıcısı açıldığında veriyi okur; mock modda örnek veridir. |
| Yönetim paneli | React + TypeScript + Vite ile ekran iskeleti, ortak shell, gezinme, tek/çok şube örnekleri hazır. Çoğu alan görsel prototip/fixture. |
| Ürünler ve Menü | Menü genel bakışı, oluşturma/düzenleme, kategori/ürün seçimi ve sıralama, önizleme ve tek aktif menü seçimi PostgreSQL'e bağlıdır (`catalog.menus`). Menü fiyatı ortak ürün kaydından okunur; web/QR yayını yoktur. Ürün taslağı, fiyat sürümü, ilk POS yayını ve geçmiş API'ye bağlıdır. Kategori oluşturma/ad değiştirme API'si vardır, panel formu henüz yoktur. |
| Tek şube demo ve reçete/stok/sayım | 6 ürün, 4 reçete, 4 cari ve 9 hammadde ortak kimlikli demo sözleşmesindedir. `VITE_INVENTORY_PROVIDER=http` ile hammadde/eşik, depo kapsamlı bakiye/hareket, reçete ve sayım PostgreSQL API'sinden okunur/yazılır. Dashboard kritik uyarıyı API'den alır; stok girişi/çıkışı, teorik üretim, sayım inceleme/onayı ve açık sayım kilidi API+PostgreSQL tarayıcı kabul testinden geçer. İlk demo Kadıköy Ana Depo'yu kullanır. Satıştan otomatik tüketim, satın alma belgesi ve barkod yoktur. |
| Cari ilk işletilebilir dilim | `VITE_CARI_PROVIDER=http` ile müşteri/tedarikçi kartı, iletişim, tür bazlı feature gate, anlamlı borç/alacak/tahsilat/ödeme hareketleri, cari özeti ve tarih aralıklı ekstre PostgreSQL'e bağlanır. Tahsilat/ödeme elle girilen işletme kaydıdır; yasal fatura veya gerçek para transferi değildir. |
| Masa servisi ve waiter UI | `service` şemasında masa, personel/garson kartı, açık masa-adisyon bağı ve audit vardır. `/waiter` ekranı garson, masa ve yayınlanmış üründen sipariş oluşturup API'ye gönderir. `/kitchen` ekranı API kuyruğunu yaklaşık üç saniyede yeniler. Geliştirme akışıdır; gerçek oturum, mutfak durum makinesi ve cihaz-yazıcı entegrasyonu değildir. |
| Satış ve ortak adisyon | `sales.checks` adisyon, `sales.orders` sipariş/kalem, `sales.payment_attempts` simüle ödeme girişimini saklar. Yeni check API'si siparişi adisyona bağlar; garson API'si de masa siparişinde ortak adisyon oluşturur/kullanır. Yönetim satış görünümü HTTP sağlayıcıyla okur. Adisyon taşıma/birleştirme/kapama, gerçek tahsilat, iade ve mali belge yoktur. Ayrıntı [Ortak Adisyon Sözleşmesi](ORTAK_ADISYON_SOZLESMESI.md). |
| Test POS ve ödeme simülatörü | Yönetimden ayrı `apps/pos` ekranı vardır. Yayınlanmış üründen PostgreSQL siparişi ve simüle ödeme girişimi/sonucu oluşturur; sonuçlar `simulated` niteliğindedir. Bu test yüzü gerçek POS/kart tahsilatı veya üretim güvenliği değildir. |
| Gider Yönetimi | `finance.expenses` capability'si, `finance` şemasında manuel TRY giderini listeleyip oluşturur. Bu kayıt kasa, cari, muhasebe fişi veya e-belge oluşturmaz. [Gider sözleşmesi](GIDER_YONETIMI_MVP.md). |
| Modül kataloğu | Tanım (`FeatureDefinition`) ve şube durumu (`BranchFeatureState`) ayrıldı. `desiredEnabled`, `effectiveForNewWork`, `lifecycle`, `blockers`, `version` ayrı alanlar. |
| Modül ekranı | Şube bazlı aç/kapa önizlemesi, bağımlılık uyarıları, kurulum/sağlayıcı/kapanma durumları ve sürüm çakışmasında yenileme var. Kapalı modülün geçmiş/örnek okuması sürüyor. |
| .NET API | ASP.NET Core 10 üzerinde modül listesi, durum, sürümlü tercih komutu, örnek kapsam/işlem izni, denetim kaydı ve yeni iş politikası uçları var. |
| Depolama | Varsayılan modül belleği; `HIPOS_FEATURE_STORAGE=postgres` ile EF Core 10 + Npgsql + PostgreSQL. Sekiz migration context'i vardır: `modules`, `catalog`, `sales`, `cari`, `service`, `inventory`, `cash`, `finance`. Yerel sunucu/merkezi DB replikasyonu yoktur. |
| Eşzamanlılık | Aynı şubenin modül satırları işlem içinde kilitleniyor. Eski `expectedVersion` 409 döndürüyor. Bağımlılık ve yazma aynı işlemde. |
| Testler | Tip/derleme, frontend birim ve tarayıcı testleri; API HTTP testi; panel–API tarayıcı testi; geçici gerçek PostgreSQL ile taslak → fiyat → yayın → sipariş → simüle ödeme zinciri, sunucu yeniden başlatma, şube ayrımı, tekrar istek, çakışma ve denetim kaydı testleri. |

## 3. Bu başarı neyi **henüz** kanıtlamaz?

- `X-Demo-Actor` tüm ASP.NET ortamlarında route'lar tarafından okunabilen taklit edilebilir bir başlıktır; gerçek oturum veya yetki değildir. API Production ortamında başlatılabilir olması onu üretime güvenli yapmaz. Gerçek kullanıcıya açmadan önce auth ve sunucu tarafı yetki zorunludur.
- Kalıcı dilimler: modül tercihi, katalog/taslak/fiyat/yayın, sipariş/adisyon/simüle ödeme, cari, servis/masa, stok/reçete/sayım, manuel kasa vardiyası ve manuel gider. Bunların hiçbiri kendi başına gerçek ödeme, banka, mali belge veya dış sağlayıcı entegrasyonu değildir. Gider ve kasa birbirine otomatik yazmaz.
- Satışta adisyon modeli ve birden çok sipariş bağlantısı vardır; durum listesi en son 100 adisyonla sınırlıdır. Sipariş kalem düzenleme/iptal, adisyon taşıma-birleştirme-kapama ve gerçek tahsilat tamamlanmamıştır. Mutfak UI'sı vardır fakat gerçek KDS mutasyon/state machine yoktur.
- `effectiveForNewWork` endpoint'in ilgili feature gate ve runtime readiness şartını karşılamasını sağlar; tüm capability'ler üretime hazır anlamına gelmez. Ödeme simülatörü gerçek ödeme değildir.
- İnternet kesintisinde yerel API/DB üzerinden ortak çalışma, outbox, merkezi eşitleme ve conflict çözümü henüz yoktur. Bugünkü geliştirme kılavuzu aynı bilgisayar/yerel PostgreSQL içindeki LAN demosunu anlatır.
- `draining` geçişi test amaçlı olayla doğrulanmıştır. Gerçek devam eden mutfak, ödeme veya entegrasyon işlerinin sınırları henüz modellenmemiştir.
- İlk yönetici rolleri aynı menüyü görür; gerçek firma/şube üyeliği ve işlem yetkisi henüz veritabanında değildir.
- Kod iş alanlarına ayrılmaya başlamıştır; tam modüler monolit modül sınırları, modüller arası olaylar ve tüm alanların gerçek verisi henüz kurulmamıştır.
- Gerçek sağlayıcı bağlantıları ve Türkiye mevzuatı uyumu yapılmış gibi gösterilmez.

## 4. Güncel çalışma önceliği (ürün hedefi)

İki paralel dilim hedefleniyor: (A) gerçek hesap/oturum/kapsam yetkisi, (B) gerçek restoran kasa/POS ve offline LAN temelinin domain sözleşmesi. Öncelik ve mühendis sınırları [Mühendis Devir Rehberi](DEVIR_REHBERI.md) içindedir. İnternet yokken LAN çalışması ile yerel sunucudan merkeze eşitleme için sync topolojisi uygulamaya başlamadan ADR ile karara bağlanmalıdır.

Çalışan parçalar kod tabanında kalıcı ürün/katalog, masa/garson, ortak adisyon, sipariş, simüle ödeme, manuel kasa ve gider API'lerini içerir. Gerçek kullanım için önce gerçek aktör/oturum/şube yetkisi; sonra check lifecycle, kasa ödeme akışları ve gerçek operasyon UX'i; bunlarla eşzamanlı yerel sunucu/offline eşitleme kararı ve altyapısı gerekir. Ürün sözleşmeleri: [Kasa/POS](KASA_POS_VE_OPERASYON_SOZLESMESI.md), [Ortak Adisyon](ORTAK_ADISYON_SOZLESMESI.md), [Kimlik](KIMLIK_VE_HESAP_AKISI.md), [Offline](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md).

Pilot hesap akışı **kontrollü ve dar kapsamlı** olacak: ilk firma ve sahibi HIPOS ekibi oluşturacak; herkese açık kayıt ve Google/Gmail girişi şimdilik yok. Bu öncelik değişimi güvenliği erteleme izni değildir. Gerçek verili pilot dış kullanıcıya açılmadan önce sunucu oturumu, firma/şube üyeliği ve işlem yetkisi uygulanmalı; seçili şube sunucuda bağımsız doğrulanmalı. İlk UI kararı değişmez: yönetici rolleri aynı ekranları görür. Ayrıntı [Kimlik ve Hesap Akışı](KIMLIK_VE_HESAP_AKISI.md) belgesindedir.

Kimlik kapısının kabul koşulları: girişsiz istek 401; başka firmaya/şubeye okuma ve yazma 403; yetkili yönetici kendi şubesini görür; denetim kaydı demo başlık yerine gerçek kullanıcı kimliğini taşır. Parola saklama, oturum/CSRF koruması, parola sıfırlama ve e-posta doğrulama değerlendirilmeden “üretim girişi tamam” denmez.

## 5. Sıradaki doğrulanacak ürün ve teknik kararlar

1. Yerel sunucu ve merkezi veritabanı yazma otoritesi; online isteklerin hangi API'ye gittiği; internet kesintisi/geri dönüş davranışı.
2. Adisyon yaşam döngüsü: düzenleme, iptal, taşıma/birleştirme, kısmi/karma ödeme, kapama ve iade.
3. Auth oturumu LAN internet kesintisinde nasıl doğrulanır; kullanıcı/rol iptali local ağa nasıl yansır.
4. KODDATA/Token/Beko modeli, OS, SDK, mali cihaz ve test slot'u; teknik uyumluluk sağlayıcıdan yazılı doğrulanır. [Entegrasyon envanteri](ENTEGRASYON_ENVANTERI_VE_TOKEN_SURECI.md).
5. Rapor, satıştan stok tüketimi, satın alma ve finans/cari bağlarının iş olayları ve mutabakatı.
6. Yerel sunucu veya LAN da kesildiğinde cihaz bazlı iş kuyruğunun kapsamı ayrıca karara bağlanır; bu, mevcut internet kesintisi + LAN çalışması gereksiniminden ayrıdır.

## 6. Teknik kalite kapıları

- Her yeni alan için API sözleşmesi, firma/şube kapsamı, yetki, sürüm/çakışma, denetim kaydı ve boş/hata durumları tanımlanır.
- Şema migration'ı kod değişikliği/deployment parçasıdır; modül aç/kapa komutu migration çalıştırmaz. Üretime uygulamadan önce migration SQL'i incelenir, yedekleme/geri dönüş planı hazırlanır.
- PostgreSQL testi tek süreçten öteye genişletilir: ayrı API örnekleri, gerçek iş komutları, bekleyen iş kapanışı ve gerekirse satır güvenliği ayrıca sınanır.
- Frontend mock ile HTTP sağlayıcısının sözleşmesi zamanla OpenAPI ve otomatik tip üretimiyle eşleştirilir; iki taraftaki katalog tanımı elle çoğaltılmaya devam etmez.
- Otomatik testler CI'da çalışır; bağımlılık ve güvenlik taraması, erişilebilirlik ve performans eşikleri eklenir.

## 7. Bugünkü net karar

Uygulama, modüler iş alanları ve PostgreSQL'e kalıcı yazan bazı API dilimleri içeriyor; tam restoran operasyonu, üretim auth'ı, gerçek ödeme/ÖKC, internet kesintisinde LAN sunucusu ve merkezi eşitleme henüz tamamlanmış değildir. API'nin Production ortamında açılabiliyor olması bu gereksinimleri sağlamaz. Gerçek müşteri pilotu için devir rehberindeki kabul kapıları geçilmelidir.
