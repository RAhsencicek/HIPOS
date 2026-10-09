# HIPOS — Tek şubeli ilk ürün için yön taslağı

Durum: 8 Ekim 2026, **tartışma geçmişi**. Bu belge yeni önceliklerin konuşulduğu taslak kaydıdır; yaşayan karar/uygulama kaynağı değildir. Sonraki kararlar ve gerçekleşen durum için [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md), [İlk Üç Aşama](ILK_UC_ASAMA.md) ve [Durum/Yol Haritası](DURUM_VE_YOL_HARITASI.md) esas alınır. Eski metindeki “kararlar netleşince diğer belgeler güncellenecek” notu tarihsel kalmıştır.

Uygulama notu: Bu taslaktaki cari kararı ilk dilim için **manuel hareket dahil** biçiminde uygulandı. PostgreSQL kart/hareket API'si, isteğe bağlı HTTP paneli, kart düzenleme ve devir/dönem/kapanış ekstresi hazır; finans ekranı bağlantısı hâlâ açık. Ürün detayında demo reçete kalemleri görünür, fakat kalıcı reçete düzenlemesi yoktur. Güncel teslim/kalan ayrımı [İlk Üç Aşama](ILK_UC_ASAMA.md) belgesindedir.

## 1. Ürün tezi ve tanıtım sınırı

İlk gösterilebilir HIPOS, **tek şubeli bir yeme içme işletmesinin arka ofis temelini** anlaşılır ve tutarlı biçimde yürütür. Ürün, gerçek işletme verisiyle dolu bir şirket izlenimi veren tek bir örnek senaryoya dayanır. Çok şube, marka, merkezden yayın ve kapsam seçici teknik olarak genişleme yönü olarak korunur; ilk satış anlatımının omurgası değildir.

İlk anlatım önerisi: Yönetici ürün ve fiyatını görür; ürünün reçetesini ve hammaddesini bağlar; stok durumunu izler; fiziksel sayım girer ve sistemle farkı görür; müşteri ve tedarikçi carilerini ayrı listelerde izler. Bu akışın her adımında hangi verinin kalıcı, hangisinin örnek, hangisinin henüz etkinleşmediği açıkça yazılır.

### Önerilen ilk gerçek iş çekirdeği

| Alan | İlk işe yarar kapsam | Sınır |
| --- | --- | --- |
| Ürün ve fiyat | Mevcut kategori/ürün/fiyat taslağı ve ilk yayın akışını tek şube anlatımında kullanma; fiyat görünürlüğünü sadeleştirme | Çok kanallı ve merkez fiyatı sonra |
| Hammadde ve stok | Stok kalemi, birim, mevcut miktar ve hareket kaynağını tanımlama | Satıştan otomatik tüketim için ayrı karar gerekli |
| Reçete | Satış ürünü başına sürümlü malzeme ve porsiyon miktarı; eksik birim veya malzeme için açık uyarı | Maliyet hesabı alış fiyatı ve dönüşüm kaynağı olmadan gerçek diye gösterilmez |
| Sayım | Tek şube/depo ve belirli tarih için sayım başlatma; sistem miktarının anlık görüntüsü; fiziksel miktar girişi; miktar/fiyat farkı; inceleme ve onay sonrası izli stok düzeltmesi | Barkodla okuma sonraki dilim; yalnız sayımı kaydetmek yeterli değil |
| Cari | Müşteri ve tedarikçi türleriyle kart, liste, hareket ve bakiye görünümü | Gerçek tahsilat, banka, fatura ve otomatik borç/alacak üretimi hazır değilse hareket kaynağı açıkça örnek veya elle girilmiş olarak işaretlenir |
| Genel bakış | Yukarıdaki gerçek kaynaklardan az sayıda anlaşılır özet ve duyuru | Kaynağı olmayan canlı satış/kasa iddiası yok |

Bu tablo uygulama taahhüdü değil, ilk dilim önerisidir. Özellikle cari hareketlerin ilk sürümde elle girilebilir olup olmayacağı açık karardır.

## 2. Öncelik sırası önerisi

1. Tek şubeli örnek işletmenin ürün, hammadde, müşteri, tedarikçi ve başlangıç stok verisini aynı senaryoya bağla. Seed tekrar çalıştırıldığında kopya kayıt üretmesin; demo verisi gerçek müşteri verisinden ve test kayıtlarından ayırt edilsin.
2. Cari temelini ve stok kalemlerini kalıcı modele taşı. Müşteri ile tedarikçi aynı kişi/kurum kartı çatısı altında iki ayrı tür olabilir; iş kuralları ve ekran filtreleri açık olmalı.
3. Reçete ve sayım akışını kur. Sayım farkı, sayım anındaki sistem miktarına göre hesaplanmalı; stok yalnız onaylı düzeltme hareketiyle değişmeli. Çakışma ve sayım sırasında oluşan stok hareketi ayrıca ele alınmalı.
4. Genel bakışı yeni kaynaklarla ve alt ekranları olgunluk durumlarıyla tutarlı hale getir. Tek şubeli tanıtım senaryosunu baştan sona doğrula.
5. Duyuruları hafif bir içerik alanı olarak ekle. Barkod, web sitesine yayın önerisi, ayrıntılı yetkilendirme ve çok şube derinliği sonraki dilimlerde değerlendir.

Ödeme simülatörü mevcut geliştirme kanıtı olarak kalır. Bundan sonraki ürün önceliğini ödeme sağlayıcısı veya kasa entegrasyonu belirlemez.

## 3. Cari alanı için önerilen model

Başlık önerisi: **Cariler**. İlk sekmeler: **Müşteriler** ve **Tedarikçiler**. Pazarlama, sadakat, kupon ve izinler cari kartının zorunlu parçası yapılmaz; daha sonraki müşteri ilişkileri katmanıdır. Mevcut “Cari ve Müşteriler”, “Tedarikçiler” ve finans altındaki borç/alacak yolları tekrar eden kayıtlar üretmemeli; aynı cari kimliğine bağlanmalı.

Asgari kart: tür, ad/unvan, telefon/e-posta (varsa), vergi bilgisi gerekip gerekmediği, not, aktiflik, firma/şube kapsamı. Asgari hareket: tarih, yön, tutar, kaynak, açıklama ve bakiye etkisi. Bakiye türe göre tahmin edilmemeli; tanımlı hareketlerden hesaplanmalı. Müşteri ile tedarikçi için aynı kartın iki tür taşıyıp taşıyamayacağı açık karardır.

İlk sürümde muhasebe/fatura doğruluğu iddiası verilmemeli. Müşteri kişisel verisi için tanıtım seed'inde kurgusal kimlik ve iletişim bilgileri kullanılmalı.

## 4. Reçete ve stok sayımı

Reçete, ürün ile stok kalemi arasındaki ölçülebilir bağı kurar: reçete sürümü, porsiyon, malzeme, miktar, birim ve gerekiyorsa fire. Ekranda “reçetesi var” etiketinden fazlası gerekir: hangi hammaddenin ne kadar kullanıldığı okunabilmeli ve değişiklik geçmişi korunmalı. Satış gerçekleştiğinde stoktan ne zaman düşüleceği ayrıca karara bağlanana kadar reçete otomatik tüketim yapmaz.

Sayımın ilk dilimi önerisi: sayım taslağı → kalem bazında fiziksel miktar → sistem miktarı ve fark → inceleme/onay → stok düzeltme hareketi. Fark miktarı ve parasal fark ayrı gösterilir; parasal fark yalnız güvenilir birim maliyet varsa hesaplanır. Barkod sonraki giriş yöntemi olur ve aynı sayım satırlarına veri yazar. Barkod eşleştirmesi, mükerrer okutma, birim ve lot sorunları ayrıca tasarlanır.

## 5. Etkin olmayan ekranların sunumu

Her alt ekranda görünür durum: **Çalışıyor**, **Örnek gösterim**, **Bu özellik henüz etkinleştirilmedi**, **Bu şubede kapalı**, **Kurulum gerekiyor** veya **Gelecek planı**. “Şubede kapalı” ile “üründe henüz geliştirilmedi” farklı nedenlerdir; modül düğmesi geliştirilmemiş özelliği çalışır hale getiremez.

Alan tanıtımında iki bölüm önerisi:

- **Bu alanda neler var?**: bugün gerçekten kullanılabilen veya veriyle incelenebilen işler; karttan ilgili ekrana gidilir.
- **Gelecekte neler olacak?**: planlı işler; kartın üzerine gelince hafif büyüme ve ayrıntı, odaklanınca veya dokununca aynı ayrıntı görünür. Kart sahte işlem başlatmaz; tarih vaadi ancak onaylanmış takvim varsa yazılır.

Bu ayrım menüdeki her alt ekranın olgunluk durumunu tek bir kaynaktan okumalı; “planlandı” alanına girildiğinde çalışan işlem izlenimi oluşmamalı.

## 6. Sonraki fikirler

- **Fiyat listesi:** Anlamı açık karar. Olasılıklar: satış ürünlerinin güncel fiyat tablosu; müşteri grubuna özel fiyat; tedarikçi alış fiyatı; kanal/şube fiyat listesi. Tek bir isim altında karıştırılmamalı.
- **Web sitesine yansıtma:** Yönetici yeni ürün, fiyat değişimi veya kampanya yayınlarken “web sitesine de yansıtılsın mı?” tercihi. İlk aşamada yalnız yol haritası; gelecekte kanal bağlantısı, önizleme, açık onay, yayın sonucu ve geri alma gerekir. Web sitesi bağlantısı kurulmadan başarı gösterilmez.
- **Yetkilendirme:** Ayrıntılı rol/işlem izinleri sonraki ürün dilimi. Gerçek müşteri pilotundan önce temel oturum ve şube/veri erişim kontrolü yine zorunlu güvenlik kapısıdır.
- **Mutfak personeli:** Kişi kartı düşünülebilir; çalışma süresi, vardiya verimliliği veya kişi bazlı üretkenlik ölçümü için veri kaynağı yoksa bu metrikler ekranlardan ve ürün vaadinden çıkarılır.
- **Duyurular:** Yeni gelen ve planlanan özellikleri anlatan, kaynak ve yayın tarihi belli, düşük yoğunluklu bir genel bakış alanı. Öncelik orta.

## 7. Doküman ve uygulama uyumu için gözlenen boşluklar

- [Bugünkü yol haritası](DURUM_VE_YOL_HARITASI.md) artık reçete/stok/sayım PostgreSQL dilimini teslim edilmiş sayar; sıradaki açık ürün işi şube listesi, masa planı ve garson ataması arasındaki veri bütünlüğüdür.
- [Ana ürün tanımı](URUN_TANIMI.md) geniş bir çok şube ve operasyon haritası çiziyor; ilk tanıtım kapsamı ayrıca işaretlenmeli.
- [Özellik envanteri](OZELLIK_ENVANTERI.md) cari, stok, reçete ve sayımın bugünkü API/DB durumunu ve kalan boşluklarını ayırır.
- Bu taslak yazıldığında [stok özeti](apps/admin/src/features/inventory/InventoryPage.tsx) yalnız örnekti. Sonraki dilimde `InventoryHttpPage.tsx`, inventory migration/API/seed ve sayım kabul akışı eklendi; elle kontrol için [stok test rehberine](STOK_REÇETE_SAYIM_MANUEL_TEST.md) bakın. [Genel alt ekran sayfası](apps/admin/src/shared/GenericPage.tsx) mevcut ekranları ve geleceği ayrı bölümlerde toplar; sol menü yapısı korunur.
- [Test ödeme sözleşmesi](ODEME_SIMULATORU_SOZLESMESI.md) yapılmış geliştirme prototipini anlatır; bu çalışma geriye alınmış sayılmaz, yalnız ürün önceliği değişir.

## 8. Karar durumu ve açık sorular

1. **Karara bağlandı:** Cari kartı ve manuel borç/alacak hareketi ilk kalıcı dilimde var; gerçek fatura/tahsilat değildir.
2. **Karara bağlandı:** Tek stok alanı; fiziksel miktar kaydı stok değiştirmez; yönetici onayı fark başına tek izli düzeltme hareketi oluşturur.
3. **Karara bağlandı:** Reçete malzeme/miktar ve değiştirilemez sürüm içerir; otomatik stok tüketimi ve maliyet hesabı yapılmaz.
4. **Açık:** “Fiyat listesi”nin ekipte kastedilen iş ihtiyacı teyit edilmedi; mevcut ürün fiyatı/katalog akışından ayrı modül olarak varsayılmıyor.
5. **Çalışma varsayımı:** Tek şubeli Mahalle Fırını / Kadıköy örneği; gerçek pilot işletme türü ve günlük akış kullanıcı testiyle netleştirilecek.

Bu kararlar verildikten sonra belge kesin yol haritasına dönüştürülür; mevcut dokümanlardaki çelişen bölümler ve ekran/özellik etiketleri birlikte güncellenir.
