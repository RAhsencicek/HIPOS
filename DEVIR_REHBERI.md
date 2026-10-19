# HIPOS mühendis devir rehberi

Durum: Ürün hedefi ve ekip çalışma sözleşmesi. Güncel kod durumu için ayrıca [Backend Mimarisi ve Modül Bağımlılıkları](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) ve [Durum ve Yol Haritası](DURUM_VE_YOL_HARITASI.md) okunmalıdır. Bu belge çalışan özelliği varsaymaz; hedeflenen gerçek restoran ürününü ve iki paralel iş diliminin sınırlarını açıklar.

## 1. Ürün amacı

HIPOS, restoranın yönetim ve günlük servis işlerini aynı işletme verisi üzerinde yürüten bir üründür. Gerçek kullanıcı; yönetici panelinden katalog, fiyat, şube ve çalışanlarını yönetir; operasyon ekibi garson/kasa ekranından sipariş ve adisyon yürütür; mutfak siparişleri görür ve uygun donanımdan fiş alır. Birden çok cihaz aynı şube verisiyle çalışır.

İlk müşteri kurulumu tek restorana göre yapılandırılabilir; ürün modeli firma, şube, kullanıcı üyeliği ve cihaz/istasyon kapsamını sonradan çok müşteriye genişletebilecek şekilde kalmalıdır. Müşteri adı, ürünleri, vergileri, mutfak istasyonları, ödeme seçenekleri ve bağlı donanım kod içine sabitlenmemelidir.

## 2. Kesinleşen ürün kararları

1. **İnternet varken:** Operasyon API üzerinden yürür ve kalıcı veritabanına kaydedilir.
2. **İnternet yok, restoran LAN'ı ve yerel sunucu çalışıyor:** Garson, kasa, mutfak ve yönetim cihazları aynı yerel API/veri kaynağı üzerinden ortak çalışmayı sürdürür. Internet erişimi operasyonun önkoşulu değildir.
3. **İnternet geri gelince:** Yerel çalışmada oluşmuş kayıtlar merkezi veritabanına aktarılmaya/eşitlenmeye devam eder; bağlantı kesintisi işlem kaybına veya tekrar kaydına yol açmamalıdır.
4. İlk sürümde garson için ayrı PIN/kimlik doğrulaması yoktur. Cihazda açık olan kullanıcı oturumu işlemi ilişkilendirmek için yeterlidir. Gerçek kullanıcı girişi/üyelik ve firma/şube yetki sınırları yine gereklidir.
5. İlk kimlik akışı mevcut [Kimlik ve Hesap Akışı](KIMLIK_VE_HESAP_AKISI.md) belgesindeki HIPOS e-posta/şifre ve kontrollü pilot hesap kararını izler; herkese açık self-servis firma kaydı kapsamda değildir.
6. Bu bir gerçek restoran ürünü olarak tasarlanır. Müşteriye özgü yapılandırma sonradan yapılır; test/simülatör davranışı gerçek tahsilat, fiş veya başarı gibi sunulamaz.

## 3. Çalışma seviyesi ve mimari sınır

Üç çalışma seviyesini birbirine karıştırmayın:

| Seviye | Erişilebilir altyapı | Beklenen davranış |
|---|---|---|
| A — İnternet ve yerel LAN var | Merkezi servis/veritabanı ve yerel cihazlar erişilebilir | Kullanıcı işlemleri kalıcı API/veritabanı üzerinden yürür; bağlı cihazlar güncel durumu görür. |
| B — İnternet yok, LAN ve yerel sunucu var | Merkezi servis erişilemiyor; restoran içi API ve veritabanı erişilebilir | Tam restoran içi ortak çalışma yerel sunucu üzerinde devam eder. İşlemler yerelde kalıcı olur, merkeze eşitlenmek için sıraya alınır. |
| C — Yerel sunucu/LAN da yok | Cihazlar ortak sunucuya erişemiyor | Bu devirde hedef ve senkronizasyon ayrıntısı karara bağlanmamıştır. Cihaz içi kuyruk gerekiyorsa ayrı ürün kararı ve çakışma politikası gerekir; ortak anlık durum garanti edilemez. |

**Önerilen sistem-of-record modeli (mühendisler uygulamaya başlamadan ADR ile kesinleştirmeli):** Restoranın yerel sunucusu, LAN işlemleri için aynı API ve yerel PostgreSQL'i sunar. İş komutları önce bu yerel kalıcı kayda yazılır; merkezi veritabanına aktarım internet yeniden gelince asenkron ve idempotent çalışır. Bağlantı varken de yazma yolunun hangi noktada yerel API'den geçtiği/merkezi servise gittiği tek bir mimari kararla belirlenmelidir. İstemci ekranları iki ayrı veri modeli geliştirmemeli; aynı domain komutları ve yanıtları çevrimiçi/yerel modda kullanmalıdır.

Bu model hâlâ bir mimari öneridir; mevcut kodda yerelden merkeze eşitleme veya outbox uygulanmış olduğu anlamına gelmez. Eşitleme yetkisi, kayıt kimliği, kaynak sürümü, yeniden deneme, silme/iptal temsili, para/ödeme sonucu, saat ve çakışma davranışı `CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md` içinde uygulama öncesi karara bağlanmalıdır.

## 4. Bugünkü gerçek kod durumu

Bu bölüm 19 Ekim 2026 tarihinde incelenen repo dokümanları/kod sınırını özetler; dosya ve API ayrıntısı için durum belgesini esas alın.

- Depo tek HIPOS monoreposudur: `apps/admin` yönetim paneli, `apps/pos` geliştirme/test POS yüzü, `apps/api/Hipos.Api` .NET modüler API, PostgreSQL iş alanı şemaları.
- PostgreSQL'de sekiz EF alanı vardır: `modules`, `catalog`, `sales`, `cari`, `service`, `inventory`, `cash`, `finance`. Katalog, satış/adisyon, servis/masa, cari, stok/reçete/sayım, manuel kasa ve manuel gider dilimlerinin bir kısmı API/PostgreSQL ile çalışır.
- `apps/pos` içindeki `/waiter` ve `/kitchen` geliştirme/test sipariş yüzleridir. Mevcut mutfak fiş akışı gerçek yazıcı sürücüsü değildir.
- `sales.checks` ortak adisyon API'si check açma, sipariş ekleme, liste/detay ve check'e bağlı simüle ödeme akışını sağlar; garson masa siparişi de check'e bağlanır. Liste en son 100 check ile sınırlıdır. Adisyon kapama/taşıma/birleştirme, gerçek tahsilat, ödeme dağıtımı, mali fiş/ÖKC ve iptal/iade akışları tamamlanmış ürün değildir.
- Mevcut `cash` MVP'si manuel kasa vardiyası ve nakit defteridir; yeni nesil POS kasa ekranının yerine geçmez.
- `finance` MVP'si manuel TRY gider kaydıdır; kasa/cari/muhasebe entegrasyonu yapmaz.
- Gerçek kullanıcı girişi/oturumu/üyelik middleware'i yoktur. `X-Demo-Actor` header'ı API route'larında Development ve Production dahil okunabildiği ve taklit edilebildiği için gerçek kimlik doğrulama değildir; Production ortamında başlatma müşteri kullanımına hazır olduğu anlamına gelmez.
- Yerel LAN ortak sunucusu, internet kesintisinde merkezle eşitleme, offline outbox/senkronizasyon, conflict çözümü ve recovery protokolü henüz uygulanmış değildir.
- Belge ve çalışan kod arasında uyuşmazlık varsa önce kod ve kabul edilebilir API davranışı doğrulanır; belge durumu `gerçek / kısmen uygulanmış / tasarım / açık karar` olarak güncellenir.

## 5. Ekip görevleri ve sınırlar

İlk evrenin atanabilir görevleri ayrı, **geçici iş paketi** belgelerinde tutulur: [Mühendis 1 — Kasa ekranı, POS ve LAN](GOREV_MUHENDIS_1_POS_LAN.md) ve [Mühendis 2 — Kimlik/Oturum](GOREV_MUHENDIS_2_KIMLIK_OTURUM.md). Mühendisler önce kendilerine ait belgeyi ve aşağıdaki ortak alanı okur. Bu belgeler kalıcı teknik sözleşmelerin kopyası değildir; ne yapılacağını, sınırları ve kabul ölçütlerini atama için görünür kılar.

### Mühendis A (Mühendis 1) — Kasa ekranı, POS ve restoran operasyonu

Sahiplik: yeni nesil dokunmatik kasa ekranının tasarımı ve uygulaması; kasa yüzünün yönetici panelindeki katalog, yayınlanmış fiyat, şube, masa ve personel verileriyle tutarlı çalışması; garson/mutfakla ortak sipariş ve adisyon akışları; ortak API sözleşmesinin operasyon tarafı; LAN yerel mod bağlantısı ve tasarlanan sync istemci durumları.

Öncelikli çıktı: dokunmatik kasa ekranı akış/tasarımı (hızlı satış, barkod, masa/adisyon, sepet, ödeme ve sonuç); yönetici paneliyle veri/API ve ortak UI bileşenlerinin uyumu; garson ve mutfakla aynı sipariş/adisyon gerçekliği; domain komut/yanıt sözleşmesi; katalog/fiyat snapshot'ı; adisyon yaşam döngüsü; ödeme yöntemi/sonucu ayrımı; mutfak yönlendirme/yazıcı adaptör sınırı; `apps/pos` mı ayrı `apps/cashier` mı kararı; ağ durumu ve sync kabul senaryoları.

Sahip olmadığı alan: kimlik altyapısını veya auth sağlayıcısını tek başına tasarlayıp ortak API'de farklı bir aktör modeli kurmak. Auth sözleşmesiyle entegre olur.

### Mühendis B (Mühendis 2) — Gerçek kullanıcı girişi ve erişim

Sahiplik: HIPOS hesabı, oturum, firma üyeliği, şube kapsamı, rol/yetki temeli; API'deki demo aktörün gerçek aktör bağlamına geçişi; yönetim ekranında giriş/çıkış ve yetkisiz durumlar.

Öncelikli çıktı: mevcut kimlik kararlarının uygulanabilir veri/API modeli; `401` ve `403` ayrımı; oturum yaşam döngüsü; firma/şube sunucu tarafı erişim kontrolü; denetim kaydında gerçek kullanıcı; kasa/garson yüzlerinin oturum bağlamına bağlanma sözleşmesi.

Sahip olmadığı alan: POS domain iş kurallarını veya sipariş/ödeme yaşam döngüsünü yeniden tanımlamak. Operasyon API'sine onaylı aktör/kapsam sözleşmesi sağlar.

### Ortak alan ve karar yönetimi

- Ortak değişiklikten önce PR açıklamasında etkilenen domain ve sözleşme belirtilir. Auth aktör tipi, firma/şube bağlamı, API hata modeli, ortak UI shell ve root yapılandırması iki işin ortak temas noktalarıdır.
- Ana dala doğrudan çalışma yok. Her mühendis ayrı `codex/...` veya ekip branch'inde çalışır; küçük PR'lar, önce arayüz/sözleşme PR'ı sonra bağımlı uygulama PR'ı.
- Auth–POS bağlama noktası için `CurrentActor/SessionContext` ve çevrimdışı oturum davranışı birlikte kararlaştırılmadan iki ekip de bu modeli kendi başına oluşturmaz.
- İş kuralı belirsizse sessizce varsayım eklenmez. Bu rehberdeki karar kaydı güncellenir; ürün sonucunu değiştiren açık kararlar iş başlamadan işaretlenir.
- PR kabul koşulu: ilgili kabul senaryosu; veri kapsamı/idempotency; hata ve bağlantı durumu; migration/seed etkisi; doküman güncellemesi. Sadece ekranın görünmesi tamamlanma değildir.

### Geçici görev belgelerinin kapatılması

Bir iş paketi tüm kabul ölçütlerini karşıladığında ve ilgili değişiklikler kabul edildiğinde:

1. Karar, API/domain gereksinimi ve kalıcı kabul ölçütlerini [Kasa/POS](KASA_POS_VE_OPERASYON_SOZLESMESI.md), [Kimlik](KIMLIK_VE_HESAP_AKISI.md), [Offline](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md), [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) ve [Durum/Yol Haritası](DURUM_VE_YOL_HARITASI.md) gibi doğru ana belgelere taşıyın.
2. Uygulamanın davranışını ve kalan işleri bu ana belgelerle karşılaştırıp güncelleyin. Artık yalnız geçici atama/takip amacı taşıyan ayrıntıları tekrar etmeyin.
3. Bu rehberdeki geçici görev bağlantılarını kaldırın; iş paketi dosyasını aynı PR/karar değişikliğinde silin. Kalıcı ekip sahipliği ve rol sınırlarını anlatan A/B bölümleri rehberde kalır.
4. PR kapanış notunda kararların hangi kalıcı belgelere taşındığını belirtin. İş paketi kapanmıyorsa silmeyin; açık maddeler, sahip ve sonraki adım ile güncel tutun.

Görev belgesiyle kalıcı sözleşme çelişirse uygulama davranışını sessizce değiştirmeyin; koordinatör kararıyla kalıcı belgeyi düzeltin ve sonra geçici belgeyi kapatın.

## 6. İlk geliştirme dilimleri

1. **Ortak sözleşme ve ADR:** Yerel sunucu/merkezi DB modelini, API rotalama stratejisini, aktör/oturum modelini ve online→LAN devam geçişini kesinleştirin.
2. **Auth temel dilimi:** Gerçek giriş/oturum, kapsam çözümleme ve demo aktörünün Development testleri dışına çıkışı.
3. **Satış/adisyon domain dilimi:** Sipariş oluşturma, güncelleme, gönderme, hazırlanma, servis, adisyon kapama; her komutta idempotency ve açık state transition.
4. **Kasa UI dilimi:** Katalog, hızlı satış, masa seçimi, adisyon, ödeme seçenekleri, sonuç/iptal/belirsiz durumlar; mevcut manuel cash MVP ile kavramsal karışıklığı önleme.
5. **LAN kullanım dilimi:** Yerel API ve veritabanı kurulumu, aynı ağa bağlı cihazların erişimi, internet kesintisi/geri gelmesi sırasında olay kaydı ve sync health.
6. **Cihaz adaptör sınırları:** Barkod okuyucu (klavye/HID ise web input), yazıcı protokolü, mali cihaz/ÖKC ve ödeme terminali için adapter arayüzü. Gerçek donanım modeli doğrulanmadan uyumluluk iddiası yok.
7. **Pilot kabul:** Gerçek servis senaryoları, yeniden başlatma, ağ kesintisi ve tekrar deneme, sipariş çiftlenmesini önleme, para/ödeme mutabakatı, yetkisiz şube erişimi.

Adım 2 ile domain sözleşmesi paralel başlayabilir; fakat operasyon endpoint'leri gerçek kullanıcı bağlamına bağlanmadan pilot tamam sayılmaz. Mühendis 1'in ilk ürün teslimi çalışan kasa hızlı satış dilimi ve yönetici paneliyle aynı kalıcı veri kaynağıdır; Mühendis 2'nin auth tamamlanma kapısı tüm tenant verili API route'larını kapsar. Tek ekran taslağı veya tek korunan endpoint nihai kabul değildir. Adım 5, yazma/sync kaynağı kararı verilmeden uygulama koduna çevrilmez.

## 7. Gerçek restoran kabul ölçütleri

- Garson cihazında ürün/opsiyon seçimi, adet ve not; siparişi göndermeden taslak, gönderim sonrası mutfak yönlendirme ve sipariş durumunu görebilme.
- Yeni masa adisyonu açma, var olan masaya sipariş ekleme, masa/adisyon taşıma/birleştirme ve kapama kuralları izlenebilir; aynı komut tekrarında çift kalem/ödeme oluşmaz.
- Kasa kullanıcıya açık bakiye ve ödeme durumunu gösterir; nakit/kart/yemek kartı gibi ödeme yöntemleri gerçek provider sonucu ile simülasyonu ayırt eder. Başarısız veya belirsiz yanıt başarı gibi kapatılmaz.
- Mutfak ekranı siparişi tekrar/eksik göstermemeli; iptal/değişiklik ve istasyon yönlendirme davranışı belgelenmelidir. Yazıcı yokken ekranda görülen sipariş kaydı kaybolmaz.
- İnternet giderken yerel API/LAN kullanılabilir durumda ise başka cihazlardaki ortak durum güncel kalır ve kayıtlar yerelde kalıcıdır. İnternet geri geldiğinde her kayıt bir kez merkeze aktarılır ve eşitleme durumu gözlenebilir.
- Sunucu/LAN kesilmesi, cihazın yerel kuyruğu ve çatışma durumları açık ürün kararı olmadan tamamlanmış kapsam sayılmaz.
- Kullanıcı firma/şube dışında veri okuyamaz veya işlem yapamaz. Kayıtlar gerçek kullanıcı, cihaz/istasyon ve zamanla ilişkilendirilir.
- Ürün, fiyat, masa, ödeme yöntemi, yazıcı istasyonu ve şube yapılandırması müşteri verisidir; özel müşteri adları kod içine gömülmez.

## 8. Ana belgeler

- [Kimlik ve hesap akışı](KIMLIK_VE_HESAP_AKISI.md): giriş, pilot hesabı, üyelik.
- [Kasa/POS operasyon sözleşmesi](KASA_POS_VE_OPERASYON_SOZLESMESI.md): kasa, satış, masa, adisyon, mutfak ve adapter sözleşmesi.
- [Çevrimdışı çalışma ve eşitleme](CEVRIMDISI_CALISMA_VE_SENKRONIZASYON.md): internet/LAN modları, outbox, sync, recovery ve açık ADR'ler.
- [Backend mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md): mevcut tablolar ve API sınırları.
- [Durum ve yol haritası](DURUM_VE_YOL_HARITASI.md): mevcut kodun gerçek teslim durumu.
- [Masa servisi elle test rehberi](MASA_SERVISI_TEST.md): bugün var olan masa/garson prototipinin davranışı.
- [Kasa MVP sözleşmesi](KASA_MVP_SOZLESMESI.md): mevcut manuel nakit defteri; yeni nesil POS ekranı ile aynı kapsam değildir.
- [Token/Beko entegrasyon envanteri](ENTEGRASYON_ENVANTERI_VE_TOKEN_SURECI.md): bugünkü entegrasyon durumu ve sağlayıcıdan teyit edilecek başlıklar.

## 9. İlk gün devir kontrolü

- Geliştirme ortamını [README](README.md) adımlarıyla çalıştır; hangi API ve provider'ların kalıcı/örnek olduğunu not et.
- Kendi branch'inde mevcut akışı çalıştır ve dokümante edilmiş kapsamla farkı listele; ortak sözleşme dışına çıkıp auth veya kasa API'sini ayrı varsayımla değiştirme.
- Mühendis A, ekran/domain/sync senaryolarını ve eksik karar listesini sunar. Mühendis B, auth veri modelini ve API aktör sözleşmesini sunar.
- Koordinatörler açık kararları ADR'ye işler, ardından ilk küçük uygulama dilimlerini ve dosya sahipliğini onaylar.
- Çalışma sonunda değişen davranış, API örneği, migration, kabul senaryosu ve açık risk ilgili belgelere eklenir.
- İş ataması için ilgili geçici mühendis iş paketini kullan; tamamlanınca yukarıdaki belge yaşam döngüsüyle kalıcı kaynaklara aktar ve temizle.
