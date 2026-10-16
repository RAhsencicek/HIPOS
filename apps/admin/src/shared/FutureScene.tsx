import {
  ArrowRight, Bell, CalendarDays, Check, ChefHat, CircleAlert, Clock3,
  Coffee, CreditCard, FileText, Heart, Image, Layers3, MapPin, Package,
  ReceiptText, Settings2, ShieldCheck, ShoppingBag, Sparkles, Store,
  TrendingUp, UserRound, UsersRound, UtensilsCrossed, Wallet,
} from "lucide-react";
import type { FutureSceneSpec, SceneKind } from "../data/futureScenes";

const icons = {
  alert: CircleAlert, timeline: Clock3, menu: Coffee, gallery: Image,
  flow: ArrowRight, map: MapPin, ledger: Wallet, calendar: CalendarDays,
  people: UserRound, stock: Package, ticket: ReceiptText, bars: TrendingUp,
  rings: Sparkles, line: TrendingUp, settings: Settings2,
  segments: UsersRound, loyalty: Heart, team: UserRound, payment: CreditCard,
  allergen: ShieldCheck, composition: Layers3, channels: Store, matrix: TrendingUp,
} satisfies Record<SceneKind, typeof Bell>;

export const sceneCaptions: Record<SceneKind, string> = {
  alert: "ÖNEMLİ OLANI ZAMANINDA GÖRÜN",
  timeline: "GÜNÜN HİKÂYESİ TEK AKIŞTA",
  menu: "MENÜNÜZÜ KENDİ TARZINIZLA KURUN",
  gallery: "GÖRSELLERLE DAHA İYİ ANLATIN",
  flow: "HER ADIM BİRBİRİNE BAĞLANSIN",
  map: "HER NOKTAYI BİRLİKTE GÖRÜN",
  ledger: "RAKAMLAR SİZİN İÇİN ANLAM KAZANSIN",
  calendar: "DOĞRU GÜNÜ KOLAYCA PLANLAYIN",
  people: "MİSAFİR GRUPLARINIZI TANIYIN",
  stock: "ELİNİZDEKİNİ GÜVENLE TAKİP EDİN",
  ticket: "HER SİPARİŞİN AYRINTISI YERİNDE",
  bars: "FARKLARI BİR BAKIŞTA YAKALAYIN",
  rings: "BÜTÜNÜN İÇİNDEKİ PAYI GÖRÜN",
  line: "DEĞİŞİMİN YÖNÜNÜ GÖRÜN",
  settings: "İŞLETME SİZE GÖRE ÇALIŞSIN",
  segments: "HER MİSAFİRE UYGUN YAKLAŞIN",
  loyalty: "HER ZİYARET YENİ BİR BAĞ KURSUN",
  team: "EKİBİNİZ DOĞRU ALANDA ÇALIŞSIN",
  payment: "ÖDEME YÖNTEMLERİNİ AYRI AYRI GÖRÜN",
  allergen: "GIDA BİLGİSİNİ GÜVENLE SUNUN",
  composition: "MENÜNÜZÜN AKIŞINI BELİRLEYİN",
  channels: "HER KANALA UYGUN MENÜ SUNUN",
  matrix: "ÜRÜNLERİNİZİ DAHA İYİ TANIYIN",
};

const ringValues: Record<string, readonly [number, number, number]> = {
  "sales/channels": [56, 29, 15],
  "cash/mixed": [42, 46, 12],
  "reports/categories": [48, 34, 18],
  "reports/channels": [61, 24, 15],
  "reports/payments": [37, 49, 14],
};

const barValues: Record<string, readonly [number, number, number]> = {
  "branches/comparison": [67, 84, 57],
  "finance/period": [79, 53, 65],
  "kitchen/performance": [84, 63, 48],
  "reports/products": [87, 66, 43],
  "reports/cash": [76, 44, 62],
  "reports/staff": [59, 77, 64],
  "reports/exceptions": [43, 61, 35],
  "central/consolidated": [62, 71, 91],
  "central/comparison": [78, 67, 85],
};

const linePaths = {
  up: { curve: "M0 160 C70 145 93 170 155 128 S245 86 310 112 S408 43 480 35", points: [[95, 154], [255, 96], [410, 70]] },
  down: { curve: "M0 48 C75 58 90 42 155 93 S245 109 310 98 S395 155 480 174", points: [[95, 51], [255, 106], [410, 149]] },
  waves: { curve: "M0 143 C65 132 100 81 155 99 S240 167 305 127 S398 73 480 97", points: [[95, 95], [255, 151], [410, 87]] },
} as const;

export function FutureScene({ spec, stage, title, sceneId }: { spec: FutureSceneSpec; stage: number; title: string; sceneId: string }) {
  const { kind, items } = spec;
  const Icon = icons[kind];
  const ring = ringValues[sceneId] ?? [42, 35, 23];
  const bars = barValues[sceneId] ?? [54, 82, 67];
  const line = linePaths[sceneId.includes("prep-times") || sceneId === "reports/kitchen" ? "down" : sceneId.includes("inventory") && sceneId !== "inventory/costs" ? "waves" : "up"];
  const dateLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date()).toLocaleUpperCase("tr-TR");
  const MapIcon = sceneId.startsWith("inventory/") ? Package : sceneId.startsWith("kitchen/") ? ChefHat : Store;
  const GalleryIcon = sceneId === "finance/documents" || sceneId === "inventory/invoices" ? FileText : sceneId === "central/campaigns" ? Sparkles : sceneId === "catalog/images" ? Coffee : Image;
  const ledgerFigures: Record<string, readonly [string, string, string]> = {
    "catalog/prices": ["₺120", "₺210", "₺120"],
    "sales/discounts": ["%10", "₺45", "₺405"],
    "finance/tax": ["%10", "₺840", "₺2.090"],
    "inventory/adjustments": ["12 kg", "10 kg", "+2 kg"],
    "inventory/portion-cost": ["₺48", "₺86", "₺170"],
    "settings/currencies": ["₺1.250", "$35", "€28"],
    "settings/tax": ["%10", "%20", "%10"],
  };
  const figures = ledgerFigures[sceneId] ?? ["₺1.250", "₺840", "₺2.090"];
  const label = `${title}: ${items[stage]}. Temsili örnek.`;
  const item = (text: string, index: number) => <span key={text} className={`future-scene-item ${stage === index ? "is-current" : ""} ${stage > index ? "is-done" : ""}`}>
    <span className="future-scene-item-icon">{stage > index ? <Check size={20} /> : <Icon size={20} />}</span>
    <strong>{text}</strong>
    <small>{stage === index ? "Şimdi" : stage > index ? "Görüldü" : "Sırada"}</small>
  </span>;

  return <div className={`future-example future-example-${kind}`} role="img" aria-label={label}>
    {kind === "alert" && <div className="future-scene-alerts">
      <div className="future-scene-alert-head">
        <span className="future-scene-ambient"><Bell size={25} /><span className="future-scene-ping" /></span>
        <span><strong>{title}</strong><small>Günün dikkat isteyen konuları</small></span>
        <b>03</b>
      </div>
      <div className="future-scene-list">{items.map((text, index) => <div key={text} className={`future-scene-alert-card ${stage === index ? "is-current" : ""}`}>
        <span className="future-scene-alert-symbol">{index === 0 ? <CircleAlert size={21} /> : index === 1 ? <Clock3 size={21} /> : <Check size={21} />}</span>
        <span><small>{["ÖNCELİKLİ", "TAKİPTE", "İNCELEME"][index]}</small><strong>{text}</strong></span>
        <i>{index === 0 ? "Şimdi" : index === 1 ? "Bugün" : "Sonra"}</i>
      </div>)}</div>
      <div className="future-scene-alert-foot"><span><Check size={16} /> Önemli işlerin sırası görünür</span><span>0{stage + 1} / 03</span></div>
    </div>}
    {kind === "timeline" && <div className="future-scene-timeline">
      <span className="future-scene-date">{title.toLocaleUpperCase("tr-TR")} · ÖRNEK ZAMAN AKIŞI</span>
      <div className="future-scene-timeline-line" />{items.map(item)}
    </div>}
    {kind === "menu" && <div className="future-scene-menu">
      <div className="future-scene-menu-cover"><Coffee size={48} strokeWidth={1.25} /><span>ÖRNEK DÜZEN</span><strong>{title}</strong></div>
      <div className="future-scene-menu-list">{items.map(item)}</div>
    </div>}
    {kind === "gallery" && <div className="future-scene-gallery" data-gallery={sceneId === "catalog/images" ? "product" : sceneId === "central/campaigns" ? "campaign" : "document"}>
      {items.map((text, index) => <div key={text} className={`future-scene-gallery-tile ${stage === index ? "is-current" : ""}`}>
        <span className="future-scene-gallery-art"><i /><GalleryIcon size={index === 1 ? 39 : 33} strokeWidth={1.35} /><small>{sceneId === "catalog/images" ? "HIPOS · MENÜ" : sceneId === "central/campaigns" ? "YENİ FIRSAT" : "BELGE"}</small></span>
        <strong>{text}</strong><em>0{index + 1} / 03</em>
      </div>)}
    </div>}
    {kind === "flow" && <div className="future-scene-flow">
      {items.map((text, index) => <div className="future-scene-flow-step" key={text}>
        <span className={`future-scene-flow-card ${stage === index ? "is-current" : ""} ${stage > index ? "is-done" : ""}`}>
          <small>ADIM 0{index + 1}</small><span className="future-scene-item-icon">{stage > index ? <Check size={24} /> : <Icon size={24} />}</span>
          <strong>{text}</strong><i>{stage === index ? "Şimdi burada" : stage > index ? "Tamamlandı" : "Sıradaki adım"}</i>
        </span>
        {index < 2 && <span className={`future-scene-flow-connector ${stage > index ? "is-done" : ""}`}><ArrowRight size={22} /></span>}
      </div>)}
    </div>}
    {kind === "map" && <div className="future-scene-map">
      <span className="future-scene-map-road road-a" /><span className="future-scene-map-road road-b" />
      {items.map((text, index) => <div key={text} className={`future-scene-map-pin pin-${index} ${stage === index ? "is-current" : ""}`}><span><MapIcon size={20} /></span><strong>{text}</strong></div>)}
      <span className="future-scene-map-compass">N ↗</span>
    </div>}
    {kind === "ledger" && <div className="future-scene-ledger">
      <div className="future-scene-ledger-head"><span><FileText size={20} /> {title}</span><span>₺</span></div>
      {items.map((text, index) => <div key={text} className={`future-scene-ledger-row ${stage === index ? "is-current" : ""}`}><span><small>0{index + 1}</small><strong>{text}</strong></span><b>{figures[index]}</b></div>)}
      <div className="future-scene-ledger-foot"><span>Bir bakışta anlaşılır</span><Check size={18} /></div>
    </div>}
    {kind === "calendar" && <div className="future-scene-calendar">
      <div className="future-scene-calendar-top"><CalendarDays size={24} /><strong>{title}</strong><span>{dateLabel}</span></div>
      <div className="future-scene-calendar-grid">{Array.from({ length: 28 }, (_, index) => <span key={index} className={index === 6 + stage * 7 ? "is-current" : ""}>{index + 1}</span>)}</div>
      <div className="future-scene-calendar-note"><Clock3 size={18} /><strong>{items[stage]}</strong></div>
    </div>}
    {kind === "people" && <div className="future-scene-people">
      <div className="future-scene-people-avatars"><span>AY</span><span>MK</span><span>SD</span><i><Heart size={19} fill="currentColor" /></i></div>
      <div className="future-scene-people-card"><small>MİSAFİR GRUPLARI</small>{items.map(item)}<div className="future-scene-people-note"><UsersRound size={17} /> Her grubu ayrı tanıyın</div></div>
    </div>}
    {kind === "stock" && <div className="future-scene-stock">
      <div className="future-scene-stock-shelf"><span /><span /></div>
      {items.map((text, index) => <div key={text} className={`future-scene-stock-box box-${index} ${stage === index ? "is-current" : ""}`}><Package size={27} strokeWidth={1.5} /><strong>{text}</strong><span className="future-scene-stock-level"><i /></span></div>)}
      <div className="future-scene-stock-floor" />
    </div>}
    {kind === "ticket" && sceneId === "branches/open-checks" && <div className="future-scene-open-check">
      <div className="future-scene-open-check-head"><span><ReceiptText size={20} /> ADİSYON #1042</span><b>Açık</b></div>
      <div className="future-scene-open-check-tags"><span>Masa 12</span><span>Garson isteğe bağlı</span></div>
      <div className={`future-scene-open-check-order ${stage === 0 ? "is-current" : ""}`}><span>01 <strong>İlk sipariş</strong></span><small>Izgara tabağı · Filtre kahve</small><b>₺420</b></div>
      <div className={`future-scene-open-check-order ${stage === 1 ? "is-current" : ""}`}><span>02 <strong>Aynı adisyonda</strong></span><small>Çikolatalı tatlı</small><b>₺160</b></div>
      <div className={`future-scene-open-check-total ${stage === 2 ? "is-current" : ""}`}><span>Ödeme özeti <small>İki sipariş, tek hesap</small></span><strong>₺580</strong></div>
    </div>}
    {kind === "ticket" && sceneId !== "branches/open-checks" && <div className="future-scene-ticket">
      <div className="future-scene-ticket-top"><ReceiptText size={24} /><span>ÖRNEK KAYIT</span></div>
      <strong className="future-scene-ticket-title">{title}</strong>
      {items.map((text, index) => <div className={`future-scene-ticket-row ${stage === index ? "is-current" : ""}`} key={text}><span>0{index + 1}</span><strong>{text}</strong><Check size={17} /></div>)}
      <div className="future-scene-ticket-cut" /><div className="future-scene-ticket-bottom"><ShoppingBag size={18} /> Her adım aynı yerde</div>
    </div>}
    {kind === "bars" && <div className="future-scene-chart future-scene-bars">
      <div className="future-scene-chart-top"><TrendingUp size={20} /><strong>{title}</strong><span>ÖRNEK GÖRÜNÜM</span></div>
      <div className="future-scene-chart-grid">{items.map((text, index) => <div key={text} className={`future-scene-bar ${stage === index ? "is-current" : ""}`}><span style={{ height: `${bars[index]}%` }} /><strong>{text}</strong></div>)}</div>
    </div>}
    {kind === "rings" && <div className="future-scene-rings">
      <div key={stage} className="future-scene-donut" style={{ background: `conic-gradient(#608ba7 0 ${ring[0]}%, #9db8b3 ${ring[0]}% ${ring[0] + ring[1]}%, #d0bea4 ${ring[0] + ring[1]}% 100%)` }}><span><strong>{ring[stage]}%</strong><small>{items[stage]}</small></span></div>
      <div className="future-scene-ring-legend">{items.map((text, index) => <div key={text} className={stage === index ? "is-current" : ""}><i /><span>{text}</span><strong>{ring[index]}%</strong></div>)}</div>
    </div>}
    {kind === "line" && <div className="future-scene-line">
      <div className="future-scene-chart-top"><TrendingUp size={20} /><strong>{title}</strong><span>DEĞİŞİM</span></div>
      <svg viewBox="0 0 480 210" preserveAspectRatio="none" aria-hidden="true"><path className="future-scene-line-grid" d="M0 45H480M0 105H480M0 165H480"/><path className="future-scene-line-area" d={`${line.curve} V210H0Z`}/><path className="future-scene-line-path" d={line.curve}/><circle className="future-scene-line-marker" cx={line.points[stage][0]} cy={line.points[stage][1]} r="8" /></svg>
      <div className="future-scene-line-labels">{items.map((text, index) => <span key={text} className={stage === index ? "is-current" : ""}>{text}</span>)}</div>
    </div>}
    {kind === "settings" && <div className="future-scene-settings">
      <div className="future-scene-settings-top"><Settings2 size={24} /><strong>{title}</strong><span>TERCİHLER</span></div>
      {items.map((text, index) => <div key={text} className={`future-scene-setting-row ${stage === index ? "is-current" : ""}`}><span><Sparkles size={18} /><strong>{text}</strong></span><i><b /></i></div>)}
      <div className="future-scene-settings-note"><Check size={18} /> Kontrol sizde</div>
    </div>}
    {kind === "allergen" && <div className="future-scene-allergen">
      <div className="future-scene-food-card"><span><UtensilsCrossed size={34} /></span><small>ÜRÜN KARTI</small><strong>Fırın tabağı</strong><p>Misafiriniz için anlaşılır bilgi</p></div>
      <div className="future-scene-allergen-list"><span><ShieldCheck size={18} /> İÇERİK BİLGİSİ</span>{items.map((text, index) => <div key={text} className={stage === index ? "is-current" : ""}><i>{index === 0 ? "01" : index === 1 ? "02" : "03"}</i><strong>{text}</strong><Check size={16} /></div>)}</div>
    </div>}
    {kind === "composition" && <div className="future-scene-composition">
      <div className="future-scene-composition-page"><span>MENÜ DÜZENİ</span><strong>Misafirinize kolay bir seçim</strong>{items.map((text, index) => <div key={text} className={stage === index ? "is-current" : ""}><span>0{index + 1}</span><b>{text}</b><i>↕</i></div>)}</div>
      <span className="future-scene-composition-handle"><Layers3 size={24} /></span>
    </div>}
    {kind === "channels" && <div className="future-scene-channels">
      {items.map((text, index) => <div key={text} className={`future-scene-channel-card ${stage === index ? "is-current" : ""}`}><span>{index === 0 ? <Store size={29} /> : index === 1 ? <ShoppingBag size={29} /> : <Layers3 size={29} />}</span><strong>{text}</strong><small>{stage === index ? "Bu kanalda görünür" : "Ayrı bir sunum"}</small></div>)}
    </div>}
    {kind === "segments" && <div className="future-scene-segments">
      <div className="future-scene-segment-center"><UsersRound size={31} /><strong>Misafirleriniz</strong></div>
      {items.map((text, index) => <div key={text} className={`future-scene-segment segment-${index} ${stage === index ? "is-current" : ""}`}><span>{["Sık gelen", "Yeni keşif", "Özel ilgi"][index]}</span><strong>{text}</strong><i>{["36", "24", "18"][index]} kişi</i></div>)}
    </div>}
    {kind === "loyalty" && <div className="future-scene-loyalty">
      <div className="future-scene-loyalty-card"><span><Heart size={20} fill="currentColor" /> MİSAFİR KARTI</span><strong>Bir ziyaret, bir teşekkür.</strong><div>{Array.from({ length: 6 }, (_, index) => <i key={index} className={index < stage + 2 ? "is-filled" : ""}><Coffee size={19} /></i>)}</div><small>Her gelişte bağınız güçlensin</small></div>
      <div className="future-scene-loyalty-steps">{items.map((text, index) => <span key={text} className={stage === index ? "is-current" : ""}><b>0{index + 1}</b>{text}</span>)}</div>
    </div>}
    {kind === "team" && <div className="future-scene-team">
      <div className="future-scene-team-head"><UsersRound size={22} /><strong>Ekibiniz, görevine uygun yerde</strong></div>
      <div className="future-scene-team-roles">{items.map((text, index) => <div key={text} className={stage === index ? "is-current" : ""}><span>{["İS", "YN", "EK"][index]}</span><strong>{text}</strong><small>{["İşletme görünümü", "Şube yönetimi", "Günlük işler"][index]}</small></div>)}</div>
    </div>}
    {kind === "payment" && <div className="future-scene-payment">
      <div className={`future-scene-payment-method ${sceneId === "cash/cash" ? "is-cash" : sceneId === "cash/meal-card" ? "is-meal" : "is-card"}`}><span>{sceneId === "cash/cash" ? "₺" : sceneId === "cash/meal-card" ? <UtensilsCrossed size={38} /> : <CreditCard size={42} />}</span><small>{title.toLocaleUpperCase("tr-TR")}</small><strong>Ödeme kolayca izlensin</strong></div>
      <div className="future-scene-payment-steps">{items.map((text, index) => <div key={text} className={stage === index ? "is-current" : ""}><span>0{index + 1}</span><strong>{text}</strong><Check size={17} /></div>)}</div>
    </div>}
    {kind === "matrix" && <div className="future-scene-matrix">
      <div className="future-scene-matrix-title"><TrendingUp size={20} /><strong>Menünüzün fırsat haritası</strong></div>
      <div className="future-scene-matrix-grid"><span className="future-scene-matrix-axis">SATIŞ İLGİSİ ↑</span>{items.map((text, index) => <div key={text} className={`future-scene-matrix-point point-${index} ${stage === index ? "is-current" : ""}`}><span>{["★", "₺", "✦"][index]}</span><strong>{text}</strong></div>)}<small>MALİYET →</small></div>
    </div>}
  </div>;
}
