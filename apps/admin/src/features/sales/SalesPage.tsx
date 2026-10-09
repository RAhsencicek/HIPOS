import { useEffect, useMemo, useState } from "react";
import { Banknote, Clock3, CreditCard, Package, ReceiptText, Search, Store, TrendingUp, Users } from "lucide-react";
import type { ViewContext } from "../../app/context";
import { DemoNotice, MetricCard, PageHeading, StatusPill } from "../../shared/ui";

export type SalesView = "summary" | "checks" | "open";
type CheckStatus = "Mutfakta" | "Serviste" | "Ödeme bekliyor" | "Kapandı" | "İptal edildi";
type MenuItem = { productName: string; quantity: number; amount: number };
type DemoOrder = {
  id: string; branchId: string; table: string; channel: "Masa" | "Paket"; waiter: string | null;
  status: CheckStatus; total: number; paid: number; guests: number; ageMinutes: number;
  paymentMethod: "Kart" | "Nakit" | "Bekliyor"; items: MenuItem[];
};

const SAMPLE_ORDERS: DemoOrder[] = [
  { id: "ADS-1058", branchId: "kadikoy", table: "Masa 03", channel: "Masa", waiter: "Ece Yılmaz", status: "Mutfakta", total: 650, paid: 0, guests: 2, ageMinutes: 8, paymentMethod: "Bekliyor", items: [{ productName: "Karışık Pizza", quantity: 1, amount: 410 }, { productName: "Filtre Kahve", quantity: 2, amount: 240 }] },
  { id: "ADS-1057", branchId: "kadikoy", table: "Masa 12", channel: "Masa", waiter: "Mert Aydın", status: "Serviste", total: 645, paid: 300, guests: 3, ageMinutes: 15, paymentMethod: "Kart", items: [{ productName: "Tavuklu Sandviç", quantity: 2, amount: 520 }, { productName: "Ev Yapımı Limonata", quantity: 1, amount: 125 }] },
  { id: "ADS-1056", branchId: "kadikoy", table: "Paket #41", channel: "Paket", waiter: null, status: "Ödeme bekliyor", total: 445, paid: 0, guests: 1, ageMinutes: 19, paymentMethod: "Bekliyor", items: [{ productName: "Margherita Pizza", quantity: 1, amount: 320 }, { productName: "Ev Yapımı Limonata", quantity: 1, amount: 125 }] },
  { id: "ADS-1055", branchId: "kadikoy", table: "Masa 08", channel: "Masa", waiter: "Ece Yılmaz", status: "Ödeme bekliyor", total: 860, paid: 0, guests: 2, ageMinutes: 26, paymentMethod: "Bekliyor", items: [{ productName: "Margherita Pizza", quantity: 2, amount: 640 }, { productName: "San Sebastian Cheesecake", quantity: 1, amount: 220 }] },
  { id: "ADS-1054", branchId: "kadikoy", table: "Masa 09", channel: "Masa", waiter: "Mert Aydın", status: "Kapandı", total: 750, paid: 750, guests: 2, ageMinutes: 48, paymentMethod: "Kart", items: [{ productName: "Karışık Pizza", quantity: 1, amount: 410 }, { productName: "Filtre Kahve", quantity: 1, amount: 120 }, { productName: "San Sebastian Cheesecake", quantity: 1, amount: 220 }] },
  { id: "ADS-1053", branchId: "kadikoy", table: "Paket #39", channel: "Paket", waiter: null, status: "Kapandı", total: 510, paid: 510, guests: 1, ageMinutes: 71, paymentMethod: "Nakit", items: [{ productName: "Tavuklu Sandviç", quantity: 1, amount: 260 }, { productName: "Ev Yapımı Limonata", quantity: 2, amount: 250 }] },
  { id: "ADS-1052", branchId: "kadikoy", table: "Masa 02", channel: "Masa", waiter: "Ece Yılmaz", status: "Kapandı", total: 820, paid: 820, guests: 3, ageMinutes: 103, paymentMethod: "Kart", items: [{ productName: "Karışık Pizza", quantity: 2, amount: 820 }] },
  { id: "ADS-1051", branchId: "kadikoy", table: "Masa 06", channel: "Masa", waiter: "Mert Aydın", status: "Kapandı", total: 480, paid: 480, guests: 2, ageMinutes: 136, paymentMethod: "Nakit", items: [{ productName: "Tavuklu Sandviç", quantity: 1, amount: 260 }, { productName: "San Sebastian Cheesecake", quantity: 1, amount: 220 }] },
  { id: "ADS-1050", branchId: "kadikoy", table: "Masa 11", channel: "Masa", waiter: "Ece Yılmaz", status: "İptal edildi", total: 320, paid: 0, guests: 2, ageMinutes: 164, paymentMethod: "Bekliyor", items: [{ productName: "Margherita Pizza", quantity: 1, amount: 320 }] },
];

const money = (amount: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(amount);
const ageLabel = (minutes: number) => minutes < 60 ? `${minutes} dk önce` : `${Math.floor(minutes / 60)} sa ${minutes % 60} dk önce`;
const statusTone = (status: CheckStatus): "orange" | "blue" | "purple" | "green" | "neutral" =>
  status === "Mutfakta" ? "orange" : status === "Serviste" ? "blue" : status === "Ödeme bekliyor" ? "purple" : status === "Kapandı" ? "green" : "neutral";

function demoOrdersFor(ctx: ViewContext): DemoOrder[] {
  let rows = SAMPLE_ORDERS;
  if (ctx.scenarioId === "multi") {
    const branchIds = ctx.branches.map(branch => branch.id);
    rows = SAMPLE_ORDERS.map((row, index) => ({ ...row,
      id: row.id.replace("ADS-10", "ADS-24"),
      branchId: branchIds[index % Math.max(branchIds.length, 1)] ?? row.branchId,
      table: row.channel === "Paket" ? row.table : `Masa ${String((index * 3 + 4) % 20 + 1).padStart(2, "0")}`,
    }));
  }
  return rows.filter(row => !ctx.selectedBranch || row.branchId === ctx.selectedBranch.id);
}

function MockSalesPage({ ctx, view }: { ctx: ViewContext; view: SalesView }) {
  const orders = useMemo(() => demoOrdersFor(ctx), [ctx.scenarioId, ctx.selectedBranch?.id, ctx.branches]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Tümü");
  const openOrders = orders.filter(order => !["Kapandı", "İptal edildi"].includes(order.status));
  const completed = orders.filter(order => order.status === "Kapandı");
  const settled = completed.reduce((sum, order) => sum + order.paid, 0);
  const openBalance = openOrders.reduce((sum, order) => sum + order.total - order.paid, 0);
  const averageCompleted = completed.length ? completed.reduce((sum, order) => sum + order.total, 0) / completed.length : 0;
  const visible = orders.filter(order => (status === "Tümü" || order.status === status) &&
    `${order.id} ${order.table} ${order.waiter ?? ""} ${order.items.map(item => item.productName).join(" ")}`.toLocaleLowerCase("tr-TR").includes(query.toLocaleLowerCase("tr-TR")));
  const itemTotals = new Map<string, number>();
  for (const order of orders.filter(row => row.status !== "İptal edildi")) for (const item of order.items)
    itemTotals.set(item.productName, (itemTotals.get(item.productName) ?? 0) + item.quantity);
  const topItems = [...itemTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const paymentTotals = ["Kart", "Nakit"].map(method => ({ method,
    amount: completed.filter(order => order.paymentMethod === method).reduce((sum, order) => sum + order.paid, 0) }));

  if (view === "summary") return <>
    <PageHeading eyebrow="SATIŞLAR VE ADİSYONLAR" title="Satış Özeti" description={`${ctx.selectedBranch?.name ?? "Seçili işletme"} · Bugünün satış ve servis görünümü`}
      action={<StatusPill tone="purple">Örnek gösterim</StatusPill>} />
    <DemoNotice />
    <div className="sales-summary-intro"><div><span className="card-kicker">BUGÜN · {new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}</span><h2>Şubenin satış nabzı</h2><p>Tamamlanan satış, açık adisyon yükü ve ödeme dağılımı tek bakışta.</p></div><StatusPill tone="blue">{orders.length} örnek kayıt</StatusPill></div>
    <div className="metric-grid compact-grid sales-summary-metrics">
      <MetricCard icon={<TrendingUp size={22} />} title="TAMAMLANAN SATIŞ" value={money(settled)} foot={`${completed.length} kapanmış adisyon · örnek veri`} tone="green" />
      <MetricCard icon={<ReceiptText size={22} />} title="AÇIK ADİSYON" value={String(openOrders.length)} foot={`${money(openBalance)} açık bakiye`} tone="blue" />
      <MetricCard icon={<CreditCard size={22} />} title="ORT. KAPANAN ADİSYON" value={money(averageCompleted)} foot="Yalnızca kapanan örnekler" tone="purple" />
      <MetricCard icon={<Users size={22} />} title="SERVİS / PAKET" value={`${orders.filter(order => order.channel === "Masa" && order.status !== "İptal edildi").length} / ${orders.filter(order => order.channel === "Paket" && order.status !== "İptal edildi").length}`} foot="Adisyon kanallarına göre" tone="orange" />
    </div>
    <div className="sales-summary-grid">
      <section className="card sales-panel"><header><div><span className="card-kicker">TAMAMLANAN ADİSYONLAR</span><h2>Ödeme dağılımı</h2></div><CreditCard size={19} /></header>
        <div className="sales-payment-list">{paymentTotals.map(({ method, amount }) => <div className="sales-payment-row" key={method}><span className={`sales-payment-icon ${method === "Nakit" ? "cash" : "card"}`}>{method === "Nakit" ? <Banknote size={17} /> : <CreditCard size={17} />}</span><span>{method}<small>{completed.filter(order => order.paymentMethod === method).length} adisyon</small></span><strong>{money(amount)}</strong></div>)}</div>
        <p className="sales-panel-foot">Bu dağılım yalnızca kurgusal demo kayıtlarını gösterir; gerçek tahsilat değildir.</p>
      </section>
      <section className="card sales-panel"><header><div><span className="card-kicker">ÜRÜN HAREKETİ</span><h2>Öne çıkan ürünler</h2></div><Package size={19} /></header>
        <div className="sales-top-products">{topItems.map(([name, quantity], index) => <div className="sales-top-product" key={name}><span>{String(index + 1).padStart(2, "0")}</span><strong>{name}</strong><small>{quantity} adet</small></div>)}</div>
        {!topItems.length && <p className="sales-panel-foot">Gösterilecek ürün hareketi yok.</p>}
      </section>
    </div>
    <section className="card sales-panel sales-recent-panel"><header><div><span className="card-kicker">SON KAPANANLAR</span><h2>Günün son işlemleri</h2></div><Clock3 size={19} /></header>
      <div className="sales-recent-list">{completed.slice(0, 3).map(order => <div className="sales-recent-row" key={order.id}><span className="sales-recent-check"><ReceiptText size={16} /></span><span><strong>{order.id} · {order.table}</strong><small>{order.items.map(item => `${item.quantity}× ${item.productName}`).join(" · ")}</small></span><StatusPill tone="green">Kapandı</StatusPill><strong>{money(order.total)}</strong></div>)}</div>
      {!completed.length && <div className="empty-list">Bugün kapanan örnek adisyon yok.</div>}
    </section>
  </>;

  if (view === "open") {
    const groups: CheckStatus[] = ["Mutfakta", "Serviste", "Ödeme bekliyor"];
    return <>
      <PageHeading eyebrow="SATIŞLAR VE ADİSYONLAR" title="Açık Adisyonlar" description="Henüz kapanmamış adisyonları servis ve mutfak durumlarına göre takip edin."
        action={<StatusPill tone="purple">Örnek gösterim · salt okunur</StatusPill>} />
      <DemoNotice />
      <div className="sales-open-summary"><div><strong>{openOrders.length}</strong><span>açık adisyon</span></div><div><strong>{money(openBalance)}</strong><span>ödenmemiş bakiye</span></div><div><strong>{openOrders.filter(order => order.waiter).length}</strong><span>garson atanmış masa</span></div></div>
      {openOrders.length === 0 ? <div className="card generic-empty">Bu şubede açık adisyon bulunmuyor.</div> : <div className="sales-open-groups">{groups.map(group => {
        const groupOrders = openOrders.filter(order => order.status === group);
        return <section className="sales-open-group" key={group}><header><h2>{group}</h2><span>{groupOrders.length}</span></header>
          {groupOrders.length ? <div className="sales-open-cards">{groupOrders.map(order => <article className="card sales-open-card" key={order.id}>
            <header><strong>{order.table}</strong><StatusPill tone={statusTone(order.status)}>{order.status}</StatusPill></header>
            <div className="sales-open-meta"><span><ReceiptText size={14} />{order.id}</span><span><Clock3 size={14} />{ageLabel(order.ageMinutes)}</span><span><Store size={14} />{order.channel}</span></div>
            <ul>{order.items.map(item => <li key={item.productName}><span>{item.quantity}× {item.productName}</span><strong>{money(item.amount)}</strong></li>)}</ul>
            <footer><span>{order.waiter ? `Garson · ${order.waiter}` : "Garson atanmamış"}<small>{order.guests} kişilik</small></span><strong>{money(order.total)}<small>{order.paid ? `${money(order.paid)} ödendi · ` : ""}{money(order.total - order.paid)} kalan</small></strong></footer>
          </article>)}</div> : <div className="sales-open-empty">Bu aşamada açık adisyon yok.</div>}
        </section>;
      })}</div>}
    </>;
  }

  return <>
    <PageHeading eyebrow="SATIŞLAR VE ADİSYONLAR" title="Adisyonlar" description="Şubedeki masa ve paket adisyonlarını ürün, durum, ödeme ve sorumlu çalışan bilgileriyle inceleyin."
      action={<StatusPill tone="purple">Örnek gösterim · salt okunur</StatusPill>} />
    <DemoNotice />
    <div className="sales-check-toolbar"><div><strong>{visible.length}</strong><span> kayıt gösteriliyor</span></div><label className="sales-search"><Search size={16} /><input aria-label="Adisyonlarda ara" placeholder="Adisyon, masa, ürün veya garson ara…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="Adisyon durumu" value={status} onChange={event => setStatus(event.target.value)}>{["Tümü", "Mutfakta", "Serviste", "Ödeme bekliyor", "Kapandı", "İptal edildi"].map(value => <option key={value}>{value}</option>)}</select></div>
    <div className="card content-card sales-check-list"><div className="table-scroll"><table><thead><tr><th>ADİSYON / AÇILIŞ</th><th>MASA / KANAL</th><th>ÜRÜNLER</th><th>GARSON</th><th>DURUM</th><th>ÖDEME</th><th className="numeric">TOPLAM</th></tr></thead>
      <tbody>{visible.map(order => <tr key={order.id}><td><strong>{order.id}</strong><small>{ageLabel(order.ageMinutes)}</small></td><td>{order.table}<small>{order.channel} · {order.guests} kişi</small></td>
        <td>{order.items.map(item => `${item.quantity}× ${item.productName}`).join(", ")}</td><td>{order.waiter ?? "—"}</td><td><StatusPill tone={statusTone(order.status)}>{order.status}</StatusPill></td>
        <td>{order.paid ? `${money(order.paid)} ödendi` : order.status === "Kapandı" ? "Ödendi" : "Bekliyor"}<small>{order.paymentMethod}</small></td><td className="numeric strong">{money(order.total)}{order.total > order.paid && order.paid > 0 && <small>{money(order.total - order.paid)} kalan</small>}</td></tr>)}</tbody></table>
      {!visible.length && <div className="empty-list">Filtrelerle eşleşen adisyon bulunamadı.</div>}</div><div className="table-footer">Örnek işletme verisi · Yönetici ekranı salt okunur</div></div>
  </>;
}

type LiveOrder = { id: string; branchId: string; source: string; status: string; paymentStatus: string; totalMinor: number; paidMinor: number; remainingMinor: number; createdAt: string; items: Array<{ productName: string; quantity: number }> };
const moneyMinor = (amountMinor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amountMinor / 100);
const paymentLabel: Record<string, string> = { unpaid: "Ödenmedi", partially_paid: "Kısmi · simüle", paid: "Ödendi · simüle", pending: "Bekliyor · simüle", unknown: "Belirsiz · simüle" };

function LiveSalesPage({ ctx, view }: { ctx: ViewContext; view: SalesView }) {
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const branchId = ctx.selectedBranch?.apiId ?? null;
  useEffect(() => {
    let active = true;
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180";
    const actor = ctx.firmId === "11111111-1111-4111-8111-111111111111" ? "manager-single" : "manager-multi";
    const path = `/api/v1/firms/${ctx.firmId}/sales/orders${branchId ? `?branchId=${branchId}` : ""}`;
    setState("loading");
    async function refresh() {
      try {
        const response = await fetch(`${base}${path}`, { headers: { "X-Demo-Actor": actor } });
        if (!response.ok) { const problem = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(problem.detail ?? "Siparişler yüklenemedi."); }
        const data = await response.json() as { items: LiveOrder[] };
        if (active) { setOrders(data.items); setState("ready"); setError(""); }
      } catch (cause) { if (active) { setState("error"); setError(cause instanceof Error ? cause.message : "Bağlantı hatası."); } }
    }
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [ctx.firmId, branchId]);

  const openOrders = orders.filter(order => order.status === "open");
  const openBalance = openOrders.reduce((sum, order) => sum + order.remainingMinor, 0);
  const heading = view === "summary" ? "Satış Özeti" : view === "open" ? "Açık Adisyonlar" : "Adisyonlar";
  return <>
    <PageHeading eyebrow="SATIŞLAR VE ADİSYONLAR" title={heading}
      description={view === "summary" ? "Veritabanındaki test POS siparişlerinin anlık özeti. Bu kaynakta kapanan satış raporu henüz yok." : view === "open" ? "Veritabanındaki açık test POS siparişleri; 5 saniyede bir yenilenir." : "Veritabanındaki sipariş kayıtları ve simüle ödeme durumları."}
      action={<StatusPill tone="blue">PostgreSQL · salt okunur</StatusPill>} />
    <div className="notice" role="status">Gerçek veritabanı kayıtları gösteriliyor. Ödeme akışı simülatördür; gerçek tahsilat veya kapanış yapılmaz. Mock satış rakamları bu görünümle karıştırılmaz.</div>
    {state === "loading" && <div className="card empty-list" role="status">Siparişler yükleniyor…</div>}
    {state === "error" && <div className="card empty-list" role="alert">{error}</div>}
    {state === "ready" && view === "summary" && <>
      <div className="metric-grid compact-grid sales-summary-metrics"><MetricCard icon={<ReceiptText size={22} />} title="AÇIK SİPARİŞ" value={String(openOrders.length)} foot="PostgreSQL kayıt sayısı" tone="blue" />
        <MetricCard icon={<CreditCard size={22} />} title="AÇIK BAKİYE" value={moneyMinor(openBalance)} foot="Simüle ödeme sonrası kalan" tone="purple" />
        <MetricCard icon={<Package size={22} />} title="SİPARİŞ KALEMİ" value={String(orders.reduce((sum, order) => sum + order.items.reduce((n, item) => n + item.quantity, 0), 0))} foot="Açık siparişlerdeki adet" tone="orange" />
        <MetricCard icon={<Clock3 size={22} />} title="SON SİPARİŞ" value={orders[0] ? new Date(orders[0].createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—"} foot="Anlık API verisi" tone="green" /></div>
      {orders.length ? <div className="card content-card sales-live-list"><div className="card-heading padded"><div><span className="card-kicker">CANLI KAYIT</span><h2>Son test POS siparişleri</h2></div></div><LiveOrderTable orders={orders} ctx={ctx} /></div> : <div className="card empty-list">Bu şubede henüz veritabanına kaydedilmiş sipariş yok. Canlı görünüm için Test POS üzerinden örnek sipariş oluşturulabilir.</div>}
    </>}
    {state === "ready" && view === "checks" && <div className="card content-card sales-live-list"><div className="card-heading padded"><div><span className="card-kicker">GERÇEK KAYIT</span><h2>Sipariş ve ödeme kayıtları</h2></div><StatusPill tone="blue">{orders.length} kayıt</StatusPill></div>{orders.length ? <LiveOrderTable orders={orders} ctx={ctx} /> : <div className="empty-list">Bu şubede kayıtlı sipariş yok. Örnek satışlarla karışmaması için demo verisi eklenmedi.</div>}</div>}
    {state === "ready" && view === "open" && <>{openOrders.length ? <div className="sales-open-summary"><div><strong>{openOrders.length}</strong><span>açık test siparişi</span></div><div><strong>{moneyMinor(openBalance)}</strong><span>kalan bakiye · simüle</span></div><div><strong>{orders.length}</strong><span>toplam API kaydı</span></div></div> : <div className="card empty-list">Bu şubede açık sipariş kaydı yok.</div>}
      {openOrders.length > 0 && <div className="sales-live-open">{openOrders.map(order => <article className="card sales-open-card" key={order.id}><header><strong>{order.id.slice(0, 8)}…</strong><StatusPill tone="blue">Açık</StatusPill></header><div className="sales-open-meta"><span><Clock3 size={14} />{new Date(order.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span><span><Store size={14} />{ctx.branches.find(branch => branch.apiId === order.branchId)?.name ?? "Şube"}</span></div><ul>{order.items.map((item, index) => <li key={`${item.productName}-${index}`}><span>{item.quantity}× {item.productName}</span></li>)}</ul><footer><span>{paymentLabel[order.paymentStatus] ?? order.paymentStatus}</span><strong>{moneyMinor(order.totalMinor)}<small>{moneyMinor(order.remainingMinor)} kalan</small></strong></footer></article>)}</div>}</>}
  </>;
}

function LiveOrderTable({ orders, ctx }: { orders: LiveOrder[]; ctx: ViewContext }) {
  return <div className="table-scroll"><table><thead><tr><th>SİPARİŞ</th><th>ŞUBE</th><th>ÜRÜNLER</th><th>DURUM</th><th>ÖDEME</th><th>TOPLAM</th><th>AÇILIŞ</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}>
    <td><strong title={order.id}>{order.id.slice(0, 8)}…{order.id.slice(-4)}</strong><small>{order.source === "demo_service" ? "Kurgu demo" : order.source === "test_pos" ? "Test POS" : order.source}</small></td>
    <td>{ctx.branches.find(branch => branch.apiId === order.branchId)?.name ?? order.branchId}</td><td>{order.items.map(item => `${item.quantity}× ${item.productName}`).join(", ")}</td>
    <td><StatusPill tone="blue">{order.status === "open" ? "Açık" : order.status}</StatusPill></td><td><StatusPill tone={order.paymentStatus === "paid" ? "green" : order.paymentStatus === "unknown" ? "orange" : "purple"}>{paymentLabel[order.paymentStatus] ?? order.paymentStatus}</StatusPill><small>Ödenen: {moneyMinor(order.paidMinor)} · Kalan: {moneyMinor(order.remainingMinor)}</small></td>
    <td className="numeric strong">{moneyMinor(order.totalMinor)}</td><td className="muted">{new Date(order.createdAt).toLocaleString("tr-TR")}</td></tr>)}</tbody></table><div className="table-footer">{orders.length} kayıt · API sağlayıcısı · en fazla son 100 sipariş</div></div>;
}

export function SalesPage({ ctx, view }: { ctx: ViewContext; view: SalesView }) {
  return import.meta.env.VITE_SALES_PROVIDER === "http" ? <LiveSalesPage ctx={ctx} view={view} /> : <MockSalesPage ctx={ctx} view={view} />;
}
