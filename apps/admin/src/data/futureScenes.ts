export type SceneKind =
  | "alert" | "timeline" | "menu" | "gallery" | "flow" | "map"
  | "ledger" | "calendar" | "people" | "stock" | "ticket"
  | "bars" | "rings" | "line" | "settings" | "segments"
  | "loyalty" | "team" | "payment" | "allergen"
  | "composition" | "channels" | "matrix";

export type FutureSceneSpec = {
  kind: SceneKind;
  items: readonly [string, string, string];
};

// Her gelecek ekranının örneği o özelliğin kendi günlük kullanımını anlatır.
// Dış veri veya işlem üretmez; sahnelerdeki tüm bilgiler temsilidir.
const sceneDrafts: Record<string, Record<string, string>> = {
  overview: {
    alerts: "alert|Süt stoğu azalıyor|Masa 12 bekliyor|Kasa farkı incelenecek",
    activity: "timeline|Menü güncellendi|Sipariş tamamlandı|Gider kaydedildi",
  },
  branches: {
    "open-checks": "ticket|İlk sipariş eklendi|Tatlı aynı hesapta|Ödeme özeti göründü",
    comparison: "bars|Kadıköy satışları|Beşiktaş yoğunluğu|Moda servis hızı",
  },
  catalog: {
    options: "menu|Kahve boyunu seçin|Süt tercihini ekleyin|Siparişe yansıtın",
    allergens: "allergen|Ürünü seçin|Süt ve gluten bilgisi|Misafire açıkça gösterin",
    images: "gallery|Ürün fotoğrafı|Menüdeki görünümü|Misafirin seçimi",
    composition: "composition|İçecekler bölümü|En sevilen ürünler|Menü sırası",
    channels: "channels|Salon menüsü|Paket menüsü|QR menüsü",
    "branch-visibility": "map|Kadıköy menüsü|Beşiktaş menüsü|Moda menüsü",
    prices: "ledger|Latte fiyatı|Tatlı fiyatı|Güncel menü",
    "price-versions": "timeline|Önceki fiyat|Değişiklik tarihi|Yeni fiyat",
    "scheduled-prices": "calendar|Fiyatı hazırlayın|Başlangıç gününü seçin|Zamanında yayınlayın",
    publishing: "flow|Ürün kartı|Yayın kontrolü|Satış ekranı",
    "publish-history": "timeline|Dünkü menü|Bugünkü yayın|Değişiklik ayrıntısı",
  },
  sales: {
    closed: "ticket|Hesap tamamlandı|Ödeme kaydedildi|Geçmiş adisyon",
    cancelled: "alert|İptal edilen ürün|İptal nedeni|Günlük iptal görünümü",
    complimentary: "ticket|İkram ürünü|İkram nedeni|Adisyon özeti",
    discounts: "ledger|İndirim seçildi|Hesaba uygulandı|Etki görüldü",
    refunds: "flow|İade talebi|Tutar kontrolü|İade kaydı",
    channels: "rings|Salon siparişleri|Paket siparişleri|QR siparişleri",
    "table-sales": "map|Salon masaları|Masa adisyonları|Satış ritmi",
    "delivery-sales": "flow|Paket siparişi|Hazırlık|Teslimat",
    "qr-sales": "flow|QR okutuldu|Sipariş alındı|Satış görünümü",
    "kitchen-status": "ticket|Sipariş alındı|Hazırlanıyor|Servise hazır",
  },
  customers: {
    groups: "people|Müdavimler|Yeni misafirler|İlgili fırsatlar",
    segments: "segments|Ziyaret sıklığı|Tercih edilen ürün|Misafir grubu",
    loyalty: "loyalty|Ziyaret edildi|Puan kazanıldı|Ödül kullanıldı",
    coupons: "ticket|Kupon hazırlandı|Misafire sunuldu|Siparişte kullanıldı",
    consents: "settings|İletişim tercihi|İzin durumu|Güncel kayıt",
    communications: "timeline|İlk mesaj|Misafir yanıtı|Görüşme geçmişi",
    winback: "flow|Uzun süredir gelmedi|Uygun teklif|Yeniden ziyaret",
  },
  cash: {
    summary: "ledger|Güne başlangıç|Nakit ve kart|Kapanış özeti",
    movements: "timeline|Nakit giriş|Gider çıkışı|Günlük bakiye",
    shifts: "calendar|Vardiya açıldı|İşlemler izlendi|Vardiya kapandı",
    "opening-closing": "flow|Açılış tutarı|Gün içi kayıtlar|Kapanış sayımı",
    cash: "payment|Nakit tahsilat|Para üstü|Kasa toplamı",
    card: "payment|Kart tahsilatı|İşlem kaydı|Günlük toplam",
    "meal-card": "payment|Yemek kartı|Tahsilat kaydı|Yöntem toplamı",
    mixed: "rings|Nakit payı|Kart payı|Karma ödeme",
    refunds: "flow|İade seçildi|Ödeme yöntemi|Kasa görünümü",
    difference: "alert|Beklenen tutar|Sayılan tutar|Farkın nedeni",
    "end-of-day": "calendar|Son işlemler|Kasa kontrolü|Gün sonu özeti",
  },
  finance: {
    expenses: "ledger|Gider eklendi|Kategori seçildi|Dönem görünümü",
    "expense-categories": "menu|Kira gideri|Malzeme gideri|Diğer giderler",
    payables: "ledger|Ödenecek hesap|Vade tarihi|Ödeme planı",
    receivables: "ledger|Alacak kaydı|Beklenen tarih|Tahsilat görünümü",
    "supplier-debts": "ledger|Tedarikçi hesabı|Açık borç|Vade planı",
    bank: "timeline|Gelen transfer|Giden ödeme|Hesap geçmişi",
    reconciliation: "flow|Kasa kaydı|Banka kaydı|Eşleşen tutar",
    period: "bars|Gelir toplamı|Gider toplamı|Dönem dengesi",
    tax: "ledger|Vergi oranları|Vergi tutarları|Dönem özeti",
    documents: "gallery|Fatura|Makbuz|Belge arşivi",
    export: "flow|Kayıtları seçin|Aktarımı hazırlayın|Muhasebeye iletin",
  },
  inventory: {
    items: "stock|Kahve çekirdeği|Süt|Şeker",
    units: "flow|Kilogram|Gram|Reçetedeki miktar",
    warehouses: "map|Ana depo|Mutfak deposu|Bar deposu",
    "warehouse-stock": "stock|Ana depoda süt|Barda süt|Toplam miktar",
    "recipe-versions": "timeline|Eski reçete|Değişen miktar|Yeni reçete",
    production: "flow|Malzeme ayrıldı|Hazırlık yapıldı|Ürün tamamlandı",
    waste: "alert|Fire kaydı|Neden seçimi|Kayıp görünümü",
    adjustments: "ledger|Sayılan miktar|Beklenen miktar|Düzeltme kaydı",
    transfers: "flow|Kaynak depo|Transfer miktarı|Hedef depo",
    requests: "ticket|İhtiyaç oluştu|Talep hazırlandı|Onay bekliyor",
    "purchase-orders": "ticket|Ürün seçildi|Tedarikçiye iletildi|Sipariş izlendi",
    receiving: "flow|Teslimat geldi|Miktar kontrolü|Depoya alındı",
    invoices: "gallery|Alış faturası|İlgili sipariş|Belge kaydı",
    costs: "line|Geçen ay maliyet|Bugünkü maliyet|Değişim yönü",
    "portion-cost": "ledger|Malzeme payı|Porsiyon tutarı|Satış fiyatı",
    "menu-engineering": "matrix|Latte ilgisi|Makarna maliyeti|Menüdeki yıldızlar",
  },
  kitchen: {
    summary: "ticket|Bekleyen iş|Hazırlanan iş|Servise hazır",
    stations: "map|Sıcak mutfak|Soğuk mutfak|Bar",
    jobs: "ticket|Yeni mutfak fişi|Özel tercih|Hazırlık durumu",
    "prep-times": "line|Sipariş zamanı|Hazırlık süresi|Servis süresi",
    delayed: "alert|Masa 08 bekliyor|Hazırlık uzadı|Öncelik verildi",
    "printer-backups": "flow|Mutfak fişi|Yazıcı durumu|Yedek baskı",
    service: "flow|Tabak hazır|Salon gördü|Masaya ulaştı",
    calls: "alert|Masa 12 çağırdı|Garson gördü|İstek karşılandı",
    performance: "bars|Sıcak mutfak|Soğuk mutfak|Bar",
  },
  reports: {
    products: "bars|En çok satılan|Yükselen ürün|Geliştirilecek ürün",
    categories: "rings|İçecek payı|Yemek payı|Tatlı payı",
    channels: "rings|Salon payı|Paket payı|QR payı",
    cash: "bars|Nakit giriş|Kasa çıkışı|Dönem sonucu",
    payments: "rings|Nakit|Kart|Yemek kartı",
    inventory: "line|Stok girişi|Stok çıkışı|Kalan miktar",
    costs: "line|Önceki maliyet|Yeni maliyet|Değişim",
    staff: "bars|Salon ekibi|Mutfak ekibi|Vardiya yükü",
    kitchen: "line|Hazırlık süresi|Yoğun saat|İstasyon yükü",
    exceptions: "bars|İptaller|İkramlar|Tekrarlayan neden",
    reservations: "calendar|Öğle saatleri|Akşam saatleri|Hafta sonu",
    couriers: "flow|Sipariş çıktı|Kurye aldı|Teslim edildi",
    loyalty: "loyalty|Puan kazanımı|Ödül kullanımı|Tekrar ziyaret",
    recommendations: "alert|Dikkat çeken değişim|Olası neden|Yeni fırsat",
  },
  central: {
    brands: "map|Marka merkezi|Kadıköy şubesi|Moda şubesi",
    groups: "map|Avrupa yakası|Anadolu yakası|Ortak görünüm",
    menus: "menu|Ortak menü|Hedef şubeler|Yerel tercih",
    prices: "ledger|Merkez fiyatı|Şube farkı|Yayın kararı",
    campaigns: "gallery|Kampanya görseli|Katılan şubeler|Misafir fırsatı",
    publishing: "flow|Merkezde hazırlandı|Şubeye gönderildi|Yayınlandı",
    history: "timeline|Önceki yayın|Son güncelleme|Şube geçmişi",
    exceptions: "alert|Ortak kural|Şube ihtiyacı|Onaylı istisna",
    rollback: "timeline|Önceki sürüm|Geri dönüş kararı|Şube görünümü",
    consolidated: "bars|Kadıköy sonucu|Moda sonucu|Toplam sonuç",
    comparison: "bars|Birinci şube|İkinci şube|Güçlü yönler",
  },
  settings: {
    users: "team|İşletme sahibi|Yönetici|Ekip üyesi",
    integrations: "flow|Ödeme sistemi|Sipariş kanalı|Ortak veri akışı",
    devices: "stock|Satış ekranı|Mutfak yazıcısı|Şube cihazları",
    notifications: "settings|Stok uyarısı|Sipariş haberi|Bildirim tercihi",
    currencies: "ledger|TRY gösterimi|Döviz tutarı|Ortak format",
    tax: "ledger|Vergi oranı|Ürün tanımı|İşlem görünümü",
    payments: "settings|Nakit|Kart|Yemek kartı",
    branches: "map|Kadıköy ayarları|Moda ayarları|Şube tercihleri",
    system: "settings|Genel tercihler|Çalışma düzeni|Panel görünümü",
  },
};

export const futureScenes: Record<string, FutureSceneSpec> = Object.fromEntries(
  Object.entries(sceneDrafts).flatMap(([section, items]) =>
    Object.entries(items).map(([slug, draft]) => {
      const [kind, first, second, third] = draft.split("|");
      return [`${section}/${slug}`, { kind: kind as SceneKind, items: [first, second, third] as const }];
    }),
  ),
);

export function futureScene(section: string, slug: string): FutureSceneSpec {
  return futureScenes[`${section}/${slug}`] ?? {
    kind: "flow",
    items: ["İlk adım", "İşlem görünümü", "Sonuç"],
  };
}
