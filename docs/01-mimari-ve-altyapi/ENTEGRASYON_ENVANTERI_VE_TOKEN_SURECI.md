# HIPOS entegrasyon envanteri ve Token/Beko süreci

> **Dokümantasyon Hiyerarşisi:**
> * **Güncel kod durumu için:** [docs/01-mimari-ve-altyapi/BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md)
> * **Güncel teslim ve yol haritası için:** [docs/00-devir-rehberi/DURUM_VE_YOL_HARITASI.md](../00-devir-rehberi/DURUM_VE_YOL_HARITASI.md)
> * **Devir ve onboarding için:** [docs/00-devir-rehberi/DEVIR_REHBERI.md](../00-devir-rehberi/DEVIR_REHBERI.md)
> * **Tarihsel kararlar için:** [docs/05-gecmis-ve-arsiv/](../05-gecmis-ve-arsiv/)

---

### 📌 Token / Beko ÖKC Entegrasyon Gerçeklik Tablosu

| Aşama / Bileşen | Durum | Açıklama |
| :--- | :--- | :--- |
| **Başvuru** | **Yapıldı / belgelendi** | 12 Ekim 2026 tarihli kurumsal entegratör başvuru formu kayıtlıdır |
| **Geliştirici portalı** | **Bekleniyor** | Token Developer Portal erişimi ve teknik dokümantasyon bekleniyor |
| **Test cihazı** | **Yok** | Fiziksel Beko ÖKC test terminali veya laboratuvar cihazı henüz temin edilmedi |
| **SDK / API** | **Yok** | Token/Beko resmi SDK kütüphanesi veya REST/WebSocket client'ı henüz repoda yoktur |
| **HIPOS adapter’ı** | **Yok** | C# veya Node.js tabanlı mali cihaz köprüsü/sürücüsü henüz kodlanmadı |
| **ÖKC sertifikasyonu** | **Yok** | Token laboratuvar sertifikasyon test slotu ve resmi uyumluluk testi yapılmadı |
| **Pilot** | **Başlamadı** | Sahada gerçek restoran pilotu henüz başlamadı |

---

Durum tarihi: 19 Ekim 2026. Bu belge, repoda gerçekten çalışan adaptörleri; yalnız UI'da görünen entegrasyonları; dış sağlayıcıyla başlatılması gereken iş akışını birbirinden ayırır. Kaynaklardan biri ekipte paylaşılan “Beko ÖKC Entegrasyon Süreçleri” dokümanıdır. O dokümandaki süreler ortalama plan değerleridir, SLA veya HIPOS teslim taahhüdü değildir.

## 1. Bugünkü entegrasyon durumu

| Sistem/cihaz | Bugünkü durum | Devir ve ürün açısından anlamı |
|---|---|---|
| PostgreSQL | Yerel geliştirme API'sinin `memory` veya `postgres` depolama seçeneği vardır. | Restoran LAN'ında yerel sunucu ile ortak çalışma ve merkezi bulut eşitleme henüz ayrı kurulum/protokol olarak yoktur. |
| Garson → sipariş/adisyon | `apps/pos` içindeki `/waiter`, API üzerinden garson siparişini oluşturur; masa ataması ve `sales.checks` ortak adisyonu yazılır. | Bu, demo aktörlü geliştirme akışıdır; gerçek oturum, gerçek cihaz kimliği, adisyon kapama ve çevrimdışı sync yoktur. |
| Mutfak ekranı | `/kitchen` API siparişlerini periyodik sorgular; mutfak fişi tarayıcının yazdırma penceresiyle basılır. | Otomatik termal yazıcı servisi, istasyon yönlendirme/iş akışı ve mali belge entegrasyonu değildir. |
| Ödeme | `payments.simulator` PostgreSQL'de simüle girişim/sonuç saklar. | Gerçek nakit tahsilatı, banka POS'u, yemek kartı, Koddata cihazı, iade veya mutabakat yoktur. |
| Token/Beko ÖKC | Gerçek Token/Beko bağlantısı veya Beko sertifikasyon testi bu repoda uygulanmış değildir. | API/kablo/cihaz uygunluğu, Token başvurusu, sözleşme, test cihazı ve sertifikasyon adımları ayrıca yürütülmelidir. |
| Diğer sağlayıcılar | Entegrasyon katalog ve yönetim ekranında görünür; gerçek yemek platformu, ERP, banka, e-belge veya muhasebe connector'ı yoktur. | UI'daki “entegrasyon” kaydı canlı bağlantı, kimlik bilgisi veya veri alışverişi kanıtı değildir. |

## 2. HIPOS tarafında entegrasyon çalışma sırası

1. İşletme ihtiyacı, cihaz modeli, bağlantı şekli, hedef şube, kapsam ve sorumlu işletmeci belirlenir.
2. Sağlayıcı ile resmi entegrasyon talebi açılır; soru seti/teknik değerlendirme yanıtlanır.
3. Ürün toplantısında iş akışı ve teknik sorumluluklar netleştirilir.
4. Sözleşme, yetkili imzalar ve gerekli şirket evrakları tamamlanır.
5. Geliştirici portalına, güncel SDK/kütüphane/dokümana ve varsa simülatöre erişim doğrulanır.
6. Test cihazı gerekiyorsa fiyat, ödeme, cihaz/kablo ve teslim süreci doğrulanır; demo cihazı üretim mali cihazı sayılmaz.
7. HIPOS adapter'ı sağlayıcı sözleşmesine göre geliştirilir: kimlik/imza, kapsam eşlemesi, idempotency, timeout/unknown, retry, iptal/iade, log/audit ve sağlık durumu.
8. Sağlayıcı test slot'u alınır; olumlu/olumsuz senaryolar ve kanıtlar kaydedilir.
9. Başarısız bulgular giderilir; tekrar test slot'u ve olası bekleme hesaba katılır.
10. Sağlayıcı onayı ve pilot tamamlanır; pilot boyunca destek/izleme ve rollback planı tutulur.
11. Nihai onay sonrası saha kurulumu ve kullanıcı desteği operasyon planıyla açılır.

Kullanıcı tarafından paylaşılan Token/Beko süreç notundaki ortalama tahminler: ilk talep/ön değerlendirme 7–10 iş günü; toplantı yaklaşık 1 hafta; sözleşme/evrak yaklaşık 1 hafta; geliştirici kiti/doküman paylaşımı yaklaşık 1 hafta; test cihazı yaklaşık 1 hafta; integratör geliştirmesi 3–4 hafta; test slot'u 1 hafta–2 ay; uyumluluk testi yaklaşık 3 iş günü; olumsuz bulguların geliştirme ve tekrar test döngüsü 1 hafta–2 ay; onay/pilot hazırlığı yaklaşık 1 hafta ve pilot yaklaşık 2 hafta. Gerçek süre sağlayıcı yoğunluğu, eksik evrak, slot sırası ve düzeltmelere göre değişir.

Paylaşılan dokümanda test talepleri/slotları için `okc.entegrasyon@tokeninc.com`, geliştirici kaynakları için Token Developer Portal belirtilmiştir. Süreç başlatılmadan önce adreslerin ve güncel başvuru talimatlarının sağlayıcıdan teyit edilmesi gerekir. Gerçek cihaz fiyatı, protokol ve uygunluk bu belgeden çıkarılamaz.

### Başvuru formu ile güncel ürün hedefi arasındaki fark

12 Ekim 2026 tarihli Beko ÖKC entegratör başvuru PDF'sinde ürünler **HiPosMenü** ve **HiVenda** adıyla, bulut/web tabanlı ve mimariden bağımsız olarak anlatılmış; istemci tarafı Windows 10/11 ile Android 10+ olarak belirtilmiş ve cihaz haberleşmesi yerel servis üzerinden JavaScript/WebSocket/Fetch şeklinde planlanmış. Bu depo HIPOS restoran projesidir; HiVenda'nın aynı başvurudaki kapsamı ve teknik olarak ayrı bir ürün olup olmadığı doğrulanmalıdır. 19 Ekim'de netleşen HIPOS hedefi ise internet kesilse de restoran LAN'ındaki yerel API/sunucuyla devam etmek ve internet gelince merkezi veritabanına eşitlemek. Bunlar aynı mimari beyan değildir. Ayrıca başvurudaki saha tarihi ve cihaz adedi bugünkü planla teyit edilmelidir.

Token ile teknik geliştirme veya imzalı sözleşme adımına geçmeden önce başvurunun güncellenmesi gerekip gerekmediği yazılı sorulmalı; ürün adları, yerel sunucunun/agent'ın yeri, desteklenecek işletim sistemleri, cihazdan beklenen işlem türleri ve internet kesintisi davranışı netleştirilmelidir. Bu doküman başvurunun değiştirilmesini kendiliğinden zorunlu kılan hukuki bir görüş değildir; sağlayıcıyla mimari tutarlılık kontrolü için açık aksiyon kaydıdır.

## 3. Sağlayıcı entegrasyon sözleşmesi için zorunlu alanlar

İlk provider'a özel uygulama başlamadan önce şu bilgiler yazılı olmalıdır:

- Üretici/ürün adı, model ve donanım/firmware sürümü; ülke ve mevzuat kapsamı.
- USB, Ethernet/LAN, Bluetooth, seri bağlantı veya HID/klavye gibi fiziksel/taşıma protokolü; işletim sistemi ve SDK/driver sürümü.
- HIPOS'un cihazla nerede konuşacağı: tarayıcı, yerel agent/service, yerel API veya bulut API.
- Test/sandbox erişimi, terminal/merchant kimlikleri ve secret yönetimi; üretim anahtarı geliştirme verisine konmaz.
- İşlem yaşam döngüsü: başlatma, kesin başarı, başarısızlık, pending/unknown, durum sorgulama, iptal, iade, kısmi iade, tekrar ve timeout.
- Sağlayıcı event/transaction ID, idempotency ve webhook imza doğrulama/anahtar rotasyonu.
- Nakit/kart/yemek kartı ayrıştırma, tutar/para birimi, vergi/fiş çıktısı ve adisyon ilişkilendirme.
- Cihaz çevrimdışı iken sağlayıcının izin verdiği davranış; cihazın internet/merkez bağımlılığı. HIPOS LAN çalışma kararı tek başına kart veya ÖKC cihazının offline çalışacağını kanıtlamaz.
- Test slot kabul ölçütleri, sağlayıcı onay kanıtı, üretim pilotu, izleme/alarm, destek iletişimi, yükseltme ve geri dönüş planı.

Bu alanlar netleşmeden gerçek sağlayıcıyı “bağlandı” göstermek veya müşteri terminalini uyumlu ilan etmek yasaktır.

## 4. Repodaki sözleşme yerleşimi

- POS/adisyon/ödeme domain hedefi: [Kasa/POS operasyon sözleşmesi](../02-kasa-ve-operasyon/KASA_POS_VE_OPERASYON_SOZLESMESI.md).
- Gerçek ödeme olayının ileride manuel kasa defterine yansıması: [Kasa onboarding ve satış–kasa olay taslağı](../02-kasa-ve-operasyon/KASA_ONBOARDING_VE_SATIS_OLAY_SOZLESMESI.md). Bu taslak provider endpoint'i değildir.
- Yerel sunucu ve merkeze kayıt aktarımı gereksinimi: [Çevrimdışı Çalışma ve Senkronizasyon Kılavuzu](CEVRIMDISI_VE_SENKRONIZASYON.md). Bu sync altyapısı bugün uygulanmış değildir.
- Katalogdaki capability tanımları: [`contracts/feature-catalog.v1.json`](../../contracts/feature-catalog.v1.json).
- API'nin güncel route'ları: modül sözleşmeleri ve kaynak kod. Repoda şu an tam kapsamlı, üretilen OpenAPI dosyası yoktur; endpoint'ler bazı eski taslaklarda eksik olabilir.

## 5. İlk Token görüşmesine götürülecek HIPOS bilgileri

- Ürün ve senaryo: şube içinde aynı LAN'daki garson/kasa/mutfak ekranları; internet kesilince yerel sunucu; bağlantı gelince merkezi kayıt aktarımı.
- Sorulacak: Token/Beko cihazında hangi modeller ve OS destekleniyor; API/SDK/yerel agent nerede çalışmalı; kablolu/kablosuz mod farkı; restoran interneti yokken cihazın kart/mali işlem yapıp yapamayacağı; test cihazı/slot/sertifikasyon gereği.
- Sağlayıcıdan talep: güncel teknik kılavuz ve SDK, örnek/sandbox, API authentication/signature/idempotency, webhook/polling ve hata kodları, transaction/refund/void/reversal akışları, mali fiş/ÖKC çıktısı, test checklist ve resmi sertifikasyon kabul kriterleri.
- HIPOS'tan götürülecek: mevcut API/domain ve açık kararlar; adapter sınırı; yerel LAN mimari hedefi; donanımda demo ve üretim ayrımı; güvenlik sorumluları; müşteri/şube hedefi ve planlanan test akışları.

## 6. Güncelleme kuralı

Sağlayıcıdan yazılı yeni bilgi alındığında kaynak doküman tarihi/sürümü, karar sahibi, etkilediği API/adapter, migration, kabul testi ve açık risk burada veya sağlayıcıya özel ADR'de güncellenir. Sözlü varsayım, provider contract gibi sunulmaz. Bu belge resmi Token sözleşmesi veya teknik API dokümanı değildir.
