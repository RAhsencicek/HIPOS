# Yönetim Paneli — Görsel Tasarım Yönü

Durum: Kullanıcının verdiği [IdeaSoft yönetim paneli](https://sektor.myideasoft.com/panel/dashboard) referansının pano, ürün listesi ve ürün ayrıntısı ekranları incelenerek hazırlanmıştır. Bu belge bizim restoran yönetim panelinin görsel sistemine yön verir; işlev ve içerik için [Ana Ürün Dokümanı](URUN_TANIMI.md) geçerlidir.

## 1. Benimsenecek görsel dil

Referansın masaüstü düzeninde yaklaşık 240 px genişliğinde sabit sol menü, ince üst araç çubuğu ve geniş içerik alanı bulunur. Açık gri sayfa zemini üzerinde beyaz kartlar kullanılır. İncelenen sayfada gövde zemini `#f7f7f7`, metin koyu gri, aktif alt menü mor `#391ee0`, kartlar beyaz ve yaklaşık 20 px köşe yarıçaplıdır. Yazı ailesi Geist olarak gözlemlendi. Bu değerler ilk tasarım değişkenlerinin başlangıcıdır; erişilebilirlik, farklı ekran genişliği ve gerçek marka kimliği için ayarlanabilir.

Görsel kararlar:

- Sol menüde ikon + açık Türkçe alan adı; alt menüler gerektiğinde açılır. Seçili öğe güçlü mor dolgu ile belirginleşir.
- Üst çubukta genel arama, firma/marka/şube bağlamı, bildirimler ve kullanıcı menüsü bulunur. Bağlam seçicisi bizim üründe aramadan daha belirgin olmalıdır.
- Sayfalar net başlık, kısa açıklama ve sağ/üst tarafta birincil yönetsel eylemle başlar.
- Pano, dört kısa özet kartı; ardından geniş grafik/operasyon kartları ve listelerle düzenlenir. Kart yoğunluğu okunabilir kalır.
- Liste sayfası üstünde sekmeler, filtre düğmesi, geniş arama kutusu, sıralanabilir kolonlar ve satır durum etiketleri kullanılır. Filtreler seçili şubeyi veya kapsamı gizlice değiştirmez.
- Ayrıntı sayfası ana bilgileri geniş sol sütunda, durum/kapsam/yayın ve modül bilgilerini dar sağ sütunda kartlar halinde gösterir.
- Boş, yükleniyor, hata, prototip, kapalı modül ve kurulum gereken haller aynı kart ve tipografi sistemiyle açıklanır.

## 2. Restoran paneline uyarlama

Referanstaki e-ticaret terimleri, ürün içerikleri, lisans kartları, mağaza bağlantıları ve sohbet araçları bizim panelde kullanılmaz. Yerlerine restoranın gerçek yönetim kavramları gelir:

| Referans kalıbı | Bizim panelde karşılığı |
| --- | --- |
| Katalog menüsü | Ürünler ve Menü: ürün, kategori, seçenek, fiyat, yayın, kanal görünürlüğü |
| Sipariş özeti | Satışlar ve Adisyonlar: açık/kapanan adisyon, kanal, masa, mutfak ve ödeme durumu |
| Ürün tablosu | Ürün, kategori, şube kapsamı, yayın durumu, kanal görünürlüğü, fiyat ve reçete bağlantısı |
| Ürün ayrıntısı sağ kartları | Aktiflik, taslak/yayın, şube kapsamı, modül/kurulum durumu |
| Dashboard özet kartları | Günlük satış, açık adisyon, dolu masa, mutfak bekleyen işleri |
| Filtre ve arama şeridi | Tarih, firma/marka/şube, durum ve kanal filtreleri |

Ana menüde kullanıcının daha önce belirlediği tüm temel alanlar kalır. Uzun alt menüler gruplandırılır ve arama ile bulunabilir. Tek şubede gereksiz marka/şube katmanı gösterilmez; çok şubede kapsam açıkça yazılır. Sipariş, masa ve mutfak ekranlarında yönetici için durum değiştiren operasyon düğmeleri yer almaz.

## 3. İlk tasarım değişkenleri

```text
Sayfa zemini:       #f7f7f7
Kart zemini:        #ffffff
Ana metin:          #171717
İkincil metin:      #444444
Ayırıcı/kenarlık:   #e0e0e0
Aktif mor:          #391ee0
Kart köşesi:        20 px
Aktif menü köşesi:  10 px
Sol menü:           yaklaşık 240 px (masaüstü)
Yazı ailesi:        Geist; uygun yedek sans-serif
```

Durum renkleri yalnız renkle anlatılmaz; metin etiketleri ve gerekli yerde ikon kullanılır. Kart gölgeleri hafif, tablo ayırıcıları ince tutulur. Yoğun operasyon verisinde yalnız dekoratif boşluk bırakılmaz; okunabilir satır yüksekliği ve hizalama korunur.

## 4. İlk ekranlara uygulama

1. **Genel Bakış:** Referansın kart ritmini kullanır; restoran metrikleri ve şube kapsamı için yeniden düzenlenir. Her özet kartından ilgili salt okunur listeye gidilir.
2. **Ürünler ve Menü:** Referansın sayfa başlığı, sekme, filtre, arama ve tablo kalıplarını kullanır. Ürün ayrıntısında sol ana form/önizleme, sağ yayın ve kapsam kartları bulunur.
3. **Şubeler ve Canlı Durum:** Aynı kart sisteminde şube karşılaştırması, masa doluluğu ve mutfak yoğunluğu gösterilir. Masa planı salt okunurdur.
4. **Modüller ve Özellikler:** Referansın liste/kart düzeninde her modülün açık, kapalı, kurulum gerekiyor, sağlayıcı bekleniyor veya prototip durumu görünür. Etkinleştirme öncesi şube ve bağımlılık planı ayrı panelde gösterilir.
5. **Stok ve Satın Alma:** Liste, ayrıntı ve süreç adımları aynı tasarım diliyle sunulur. Gerçek backend yoksa kaydetme başarı bildirimi verilmez.

## 5. Tasarım doğrulaması

Masaüstünde referansa yakın görünüm hedeflenir. Dar ekranlarda sol menü daralır veya açılır panel olur; tablolar kritik kolonlarını korur ve yatay taşma yönetilir. Klavye ile menü, filtre ve modül durumları kullanılabilir olmalıdır. İlk iki örnek işletme senaryosunda tüm temel alanlara ulaşılabilmesi ve seçili şube kapsamının her ekranda anlaşılması kabul ölçütüdür.
