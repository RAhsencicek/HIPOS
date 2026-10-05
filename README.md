# HIPOS Yönetim Paneli

Restoran yönetim platformunun ilk frontend prototipi. Bu depo şu anda yalnız yönetim panelini içerir; POS, garson, mutfak ve müşteri ekranları henüz geliştirilmez.

## Çalıştırma

Gereksinim: Node.js 20.19 veya üzeri ve npm.

```bash
npm install
npm run dev
```

Panel: [http://localhost:5173/](http://localhost:5173/)

Derleme ve tip denetimi:

```bash
npm run build
npm run typecheck
```

## Bu sürümde

- Tek şubeli ve çok şubeli örnek işletme seçimi
- Tüm ana yönetim alanları ve alt ekranların gezilebilir menüsü
- Genel bakış, ürün listesi/ayrıntısı, şube durumu, adisyon izleme, stok özeti, raporlar ve entegrasyon görünümü
- Şube bazlı modül kataloğu ve bağımlılık gösteren açma/kapama önizlemesi
- Kapalı modül ekranı ve gerçek işlem olmadığına dair açık etiketler

Veriler örnektir. Modül seçimleri yalnız açık tarayıcı oturumunda tutulur. Kaydetme, ödeme, sipariş oluşturma ve dış sağlayıcı bağlantısı yapılmaz.

Bu ilk teslim görsel/etkileşimli tasarım prototipidir. Hedefteki alan bazlı kod ayrımı ve API biçiminde mock sağlayıcı henüz uygulanmadı; bunlar tasarım onayından sonraki frontend altyapı adımıdır.

## Ürün ve mimari belgeleri

- [Ana ürün tanımı](URUN_TANIMI.md)
- [Görsel tasarım yönü](TASARIM_YONU.md)
- [Teknik mimari](TEKNIK_MIMARI.md)
- [API ve mock veri sözleşmesi](API_VE_MOCK_SOZLESMESI.md)
