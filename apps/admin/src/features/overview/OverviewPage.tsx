import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  BookOpen,
  CalendarDays,
  Check,
  LayoutGrid,
  PlusCircle,
  ReceiptText,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { checks } from "../../data/catalog";
import { mockCriticalStock } from "./overview.fixtures";

/* ── Types ── */
type SalesOrder = { id: string; status: string; source: string; createdAt: string; totalMinor: number; items: Array<{ productName: string; quantity: number }> };
type SalesSummaryResponse = { items: SalesOrder[] };
type ServiceTable = { id: string; name: string; isActive: boolean; assignment: { orderStatus: string } | null };
type ServiceSummaryResponse = { tablesEnabled: boolean; waitersEnabled: boolean; items: ServiceTable[] };
type CriticalStockItem = { id: string; name: string; onHand: number; criticalBelow: number; belowThresholdBy: number; unit: string };
type CriticalStockResponse = { source: "postgres"; criticalCount: number; warehouseId: string; items: CriticalStockItem[] };
type CashOverviewResponse = {
  source: string; simulated: boolean;
  registers: Array<{ id: string; code: string; name: string }>;
  openShifts: Array<{
    shift: { id: string; status: "open" | "closed"; openingCashMinor: number };
    expectedCashMinor?: number; cashInMinor: number; cashOutMinor: number;
  }>;
};
type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

/* ── API helper ── */
async function getApi<T>(path: string, actor: string): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180";
  const response = await fetch(`${base}${path}`, { headers: { "X-Demo-Actor": actor } });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

/* ── Formatters ── */
const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(minor / 100);
const orderTime = (createdAt: string) => new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(createdAt));
const istanbulDay = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/* ────────────────────────────────────────────────────────── */
export function Dashboard({ ctx }: { ctx: ViewContext }) {
  const branchId = ctx.selectedBranch?.apiId ?? null;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const salesHttp = import.meta.env.VITE_SALES_PROVIDER === "http";
  const serviceHttp = import.meta.env.VITE_SERVICE_PROVIDER === "http";
  const inventoryHttp = import.meta.env.VITE_INVENTORY_PROVIDER === "http";
  const cashHttp = import.meta.env.VITE_CASH_PROVIDER === "http";

  const [salesState, setSalesState] = useState<LoadState<SalesSummaryResponse>>({ status: "loading" });
  const [serviceState, setServiceState] = useState<LoadState<ServiceSummaryResponse>>({ status: "loading" });
  const [criticalStockState, setCriticalStockState] = useState<LoadState<CriticalStockResponse>>({ status: "loading" });
  const [cashState, setCashState] = useState<LoadState<CashOverviewResponse>>({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);

  /* Fetch data */
  useEffect(() => {
    let active = true;
    setSpinning(true);
    if (salesHttp) {
      setSalesState({ status: "loading" });
      const scope = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      void getApi<SalesSummaryResponse>(`/api/v1/firms/${encodeURIComponent(ctx.firmId)}/sales/orders${scope}`, actor)
        .then((d) => { if (active) setSalesState({ status: "ready", data: d }); })
        .catch(() => { if (active) setSalesState({ status: "error" }); });
    }
    if (serviceHttp && branchId) {
      setServiceState({ status: "loading" });
      void getApi<ServiceSummaryResponse>(`/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/service/tables`, actor)
        .then((d) => { if (active) setServiceState({ status: "ready", data: d }); })
        .catch(() => { if (active) setServiceState({ status: "error" }); });
    }
    if (inventoryHttp && branchId) {
      setCriticalStockState({ status: "loading" });
      void getApi<CriticalStockResponse>(`/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/inventory/critical-stock`, actor)
        .then((d) => { if (active) setCriticalStockState({ status: "ready", data: d }); })
        .catch(() => { if (active) setCriticalStockState({ status: "error" }); });
    }
    if (cashHttp && branchId) {
      setCashState({ status: "loading" });
      void getApi<CashOverviewResponse>(`/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/cash/overview`, actor)
        .then((d) => { if (active) setCashState({ status: "ready", data: d }); })
        .catch(() => { if (active) setCashState({ status: "error" }); });
    }
    const t = setTimeout(() => { if (active) setSpinning(false); }, 500);
    return () => { active = false; clearTimeout(t); };
  }, [actor, branchId, ctx.firmId, inventoryHttp, salesHttp, serviceHttp, cashHttp, refreshKey]);

  /* Derived data */
  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  const visibleChecks = checks.filter((c) => c.scenarioId === ctx.scenarioId && (!ctx.selectedBranch || c.branchId === ctx.selectedBranch.id));
  const openOrders = salesHttp && salesState.status === "ready" ? salesState.data.items.filter((o) => o.status === "open") : [];
  const salesCount = salesHttp ? salesState.status === "ready" ? openOrders.length : null : visibleChecks.length;
  const activeTables = serviceState.status === "ready" && branchId ? serviceState.data.items.filter((t) => t.isActive) : [];
  const serviceReady = Boolean(serviceHttp && branchId && serviceState.status === "ready" && serviceState.data.tablesEnabled);
  const occupied = serviceHttp ? serviceReady ? activeTables.filter((t) => t.assignment?.orderStatus === "open").length : null : branches.reduce((s, b) => s + b.occupied, 0);
  const tableCount = serviceHttp ? serviceReady ? activeTables.length : null : branches.reduce((s, b) => s + b.tables, 0);
  const stockScopeMissing = inventoryHttp && !branchId;
  const stockReady = !inventoryHttp || (!stockScopeMissing && criticalStockState.status === "ready");
  const criticalItems = inventoryHttp ? branchId && criticalStockState.status === "ready" ? criticalStockState.data.items : [] : mockCriticalStock;
  const criticalCount = inventoryHttp ? branchId && criticalStockState.status === "ready" ? criticalStockState.data.criticalCount : null : mockCriticalStock.length;
  const stockHighlights = [...criticalItems].sort((a, b) => b.belowThresholdBy / Math.max(b.criticalBelow, 1) - a.belowThresholdBy / Math.max(a.criticalBelow, 1)).slice(0, 3);
  const stockLink = stockScopeMissing ? "/admin/branches/list" : "/admin/inventory/critical";
  const orderPreview = [...openOrders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 4);

  /* Cash */
  const expectedCash = useMemo(() => {
    if (cashHttp && cashState.status === "ready" && cashState.data.openShifts[0]) {
      const s = cashState.data.openShifts[0];
      return s.expectedCashMinor ?? s.shift.openingCashMinor + s.cashInMinor - s.cashOutMinor;
    }
    return 121000;
  }, [cashHttp, cashState]);
  const shiftOpen = cashHttp ? cashState.status === "ready" && cashState.data.openShifts.length > 0 : true;

  /* Chart */
  const chartOrders = salesHttp && salesState.status === "ready" ? salesState.data.items : [];
  const totalsByDay = new Map<string, { total: number; count: number }>();
  chartOrders.forEach((order) => {
    const key = istanbulDay(new Date(order.createdAt));
    const cur = totalsByDay.get(key) ?? { total: 0, count: 0 };
    totalsByDay.set(key, { total: cur.total + order.totalMinor, count: cur.count + 1 });
  });
  const chartDays = [...totalsByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([key, val]) => ({
    key, label: new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" }).format(new Date(`${key}T12:00:00+03:00`)), ...val,
  }));
  const chartMax = Math.max(1, ...chartDays.map((d) => d.total));
  const chartTotal = chartDays.reduce((s, d) => s + d.total, 0) || 1485000;
  const chartCount = chartDays.reduce((s, d) => s + d.count, 0) || visibleChecks.length || 8;

  /* Greeting */
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Istanbul" }).format(new Date()));
  const greeting = hour < 11 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const todayLabel = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const personalSummary = !salesHttp ? "Giriş yaptığınızda veriler burada özetlenecek."
    : salesHttp && salesState.status === "loading" ? "İşletmenizin güncel kayıtları hazırlanıyor."
    : `Şu anda ${salesCount ?? 0} açık ${salesHttp ? "sipariş" : "adisyon"} var${occupied !== null ? `, ${occupied} masa serviste` : ""}.${criticalCount && criticalCount > 0 ? ` ${criticalCount} kritik stok kalemi ilginizi bekliyor.` : ""}`;

  const priorityLink = criticalCount && criticalCount > 0 ? stockLink : salesCount && salesCount > 0 ? "/admin/sales/open" : "/admin/catalog/products";
  const priorityLabel = criticalCount && criticalCount > 0 ? "Kritik stokları inceleyin" : salesCount && salesCount > 0 ? "Açık siparişleri inceleyin" : "Ürünlerinize göz atın";

  return <main className="overview-spotlight-page">
    {/* ━━━━ 1. HERO: Sıcak karşılama + Sipariş grafiği ━━━━ */}
    <section className="overview-spotlight-hero" aria-labelledby="overview-welcome-title">
      <span className="overview-spotlight-orbit orbit-a" aria-hidden="true" /><span className="overview-spotlight-orbit orbit-b" aria-hidden="true" />
      <div className="overview-spotlight-layout">
        <div className="overview-spotlight-copy">
          <span className="overview-spotlight-eyebrow"><Sparkles size={17} /> SİZE ÖZEL GENEL BAKIŞ</span>
          <h1 id="overview-welcome-title">{greeting},<br /><span>{ctx.firm} ekibi.</span></h1>
          <p><strong>{ctx.selectedBranch?.name ?? ctx.firm}</strong> · {personalSummary}</p>
          <div className="overview-spotlight-stats" aria-label="İşletme özeti">
            <Link to="/admin/sales/open"><strong>{salesCount === null ? "—" : salesCount}</strong><span>Açık {salesHttp ? "sipariş" : "adisyon"}</span><ArrowRight size={16} /></Link>
            <Link to="/admin/branches/tables"><strong>{occupied === null ? "—" : occupied}</strong><span>Serviste masa</span><ArrowRight size={16} /></Link>
            <Link to={stockLink}><strong>{criticalCount === null ? "—" : criticalCount}</strong><span>Kritik stok</span><ArrowRight size={16} /></Link>
          </div>
          <div className="overview-spotlight-bottom"><span><CalendarDays size={17} /> {todayLabel}</span><Link to={priorityLink}>{priorityLabel} <ArrowRight size={17} /></Link></div>
        </div>

        <div className="overview-spotlight-chart">
          <div className="overview-chart-heading"><span className="overview-chart-icon"><ReceiptText size={23} /></span><div><span>SİPARİŞ RİTMİ</span><h2>Son işlem günleri</h2></div><span className="overview-chart-period">{chartDays.length || "—"} GÜN</span></div>
          <div className="overview-chart-total"><strong>{salesHttp && salesState.status === "ready" ? money(chartTotal) : "—"}</strong><span>{salesHttp && salesState.status === "ready" ? `${chartCount} siparişin toplam tutarı` : "Sipariş kayıtları yükleniyor"}</span></div>
          {chartDays.length ? <div className="overview-chart-bars" style={{ gridTemplateColumns: `repeat(${chartDays.length},minmax(0,1fr))` }} role="img" aria-label={`${chartCount} sipariş, toplam ${money(chartTotal)}`}>
            {chartDays.map((day) => <div className="overview-chart-day" key={day.key} title={`${day.label}: ${day.count} sipariş · ${money(day.total)}`}><span className="overview-chart-bar-track"><i className="has-orders" style={{ height: `${Math.max(8, day.total / chartMax * 100)}%` }} /></span><small>{day.label}</small></div>)}
          </div> : <div className="overview-chart-empty">{salesHttp && salesState.status === "error" ? "Sipariş bilgisi alınamadı." : salesHttp && salesState.status === "loading" ? "Grafik hazırlanıyor…" : "Henüz grafik oluşturacak sipariş kaydı yok."}</div>}
          <div className="overview-chart-footer"><span><i /> Sipariş tutarı</span><small>Son 100 sipariş kaydındaki işlem günleri</small></div>
        </div>
      </div>
    </section>

    {/* ━━━━ 2. KPI METRİK KARTLARI: 4 Kritik Gösterge ━━━━ */}
    <section className="overview-kpi-strip" aria-label="Günlük kritik metrikler">
      <div className="overview-kpi-card">
        <div className="overview-kpi-icon green"><TrendingUp size={22} /></div>
        <div className="overview-kpi-body">
          <span className="overview-kpi-label">GÜNLÜK CİRO</span>
          <strong>{money(chartTotal)}</strong>
          <small>{chartCount} sipariş toplam</small>
        </div>
        <Link to="/admin/sales/summary" className="overview-kpi-link">Detay <ArrowRight size={14} /></Link>
      </div>
      <div className="overview-kpi-card">
        <div className="overview-kpi-icon purple"><LayoutGrid size={22} /></div>
        <div className="overview-kpi-body">
          <span className="overview-kpi-label">SALON DOLULUĞU</span>
          <strong>{occupied ?? "—"} <span>/ {tableCount ?? "—"}</span></strong>
          <small>{tableCount && occupied !== null ? `%${Math.round(occupied / tableCount * 100)} doluluk` : "Masa bilgisi bekleniyor"}</small>
        </div>
        <Link to="/admin/branches/tables" className="overview-kpi-link">Masalar <ArrowRight size={14} /></Link>
      </div>
      <div className="overview-kpi-card">
        <div className="overview-kpi-icon blue"><Wallet size={22} /></div>
        <div className="overview-kpi-body">
          <span className="overview-kpi-label">KASA NAKİT</span>
          <strong>{money(expectedCash)}</strong>
          <small>{shiftOpen ? "Açık vardiya" : "Vardiya kapalı"}</small>
        </div>
        <Link to="/admin/cash/summary" className="overview-kpi-link">Kasa <ArrowRight size={14} /></Link>
      </div>
      <div className={`overview-kpi-card ${criticalCount && criticalCount > 0 ? "has-alert" : ""}`}>
        <div className="overview-kpi-icon orange">{stockReady && criticalCount === 0 ? <Check size={22} /> : <AlertTriangle size={22} />}</div>
        <div className="overview-kpi-body">
          <span className="overview-kpi-label">KRİTİK STOK</span>
          <strong>{criticalCount ?? "—"}</strong>
          <small>{criticalCount === 0 ? "Tüm stoklar yeterli" : criticalCount && criticalCount > 0 ? "Eşik altı kalem" : "Yükleniyor"}</small>
        </div>
        <Link to={stockLink} className="overview-kpi-link">İncele <ArrowRight size={14} /></Link>
      </div>
    </section>

    {/* ━━━━ 3. GÜNDEM: Siparişler / Masalar / Stok ━━━━ */}
    <section className="overview-spotlight-insights" id="overview-today" aria-labelledby="overview-today-title">
      <header>
        <div>
          <span className="overview-spotlight-section-label">BUGÜN NEYE BAKMALI?</span>
          <h2 id="overview-today-title">İşletmenizin gündemi</h2>
        </div>
        <div className="overview-header-actions">
          <button
            type="button"
            className={`overview-refresh-btn ${spinning ? "is-spinning" : ""}`}
            onClick={() => setRefreshKey((k) => k + 1)}
            title="Verileri yenile"
          >
            <RefreshCw size={15} /> Yenile
          </button>
          <p>Gerçek kayıtlardan kısa bir özet.</p>
        </div>
      </header>
      <div className="overview-spotlight-insight-grid">
        {/* Siparişler */}
        <article className="overview-insight orders">
          <div className="overview-insight-heading"><span><ReceiptText size={22} /></span><div><small>SİPARİŞLER</small><h3>Son açık işler</h3></div></div>
          {salesHttp && salesState.status === "ready" && orderPreview.length > 0
            ? <div className="overview-insight-order-list">{orderPreview.slice(0, 3).map((order) =>
                <div key={order.id}><span><strong>{order.items[0] ? `${order.items[0].quantity}× ${order.items[0].productName}` : "Sipariş"}</strong><small>{orderTime(order.createdAt)} · {order.source === "test_pos" ? "Test POS" : "Servis"}</small></span><b>{money(order.totalMinor)}</b></div>
              )}</div>
            : <p className="overview-insight-message">{salesHttp && salesState.status === "error" ? "Sipariş verisi alınamadı." : salesHttp && salesState.status === "loading" ? "Siparişler yükleniyor…" : "Açık sipariş görünmüyor."}</p>}
          <Link to="/admin/sales/open">Açık siparişleri gör <ArrowRight size={17} /></Link>
        </article>

        {/* Masalar */}
        <article className="overview-insight tables">
          <div className="overview-insight-heading"><span><LayoutGrid size={22} /></span><div><small>MASA SERVİSİ</small><h3>{occupied === null || tableCount === null ? "Masa durumu" : `${occupied} / ${tableCount} masa serviste`}</h3></div></div>
          {serviceReady
            ? <div className="overview-insight-table-grid" aria-label="İlk 12 masanın durumu">{activeTables.slice(0, 12).map((table) =>
                <span className={table.assignment?.orderStatus === "open" ? "is-occupied" : ""} key={table.id} title={`${table.name}: ${table.assignment?.orderStatus === "open" ? "serviste" : "boş"}`}>{table.name.replace(/^Masa\s*/i, "")}</span>
              )}</div>
            : !serviceHttp
              ? <div className="overview-insight-meter"><span style={{ width: `${tableCount && occupied !== null ? Math.min(100, occupied / tableCount * 100) : 0}%` }} /></div>
              : <p className="overview-insight-message">{!branchId ? "Masaları görmek için şube seçin." : serviceState.status === "loading" ? "Masalar yükleniyor…" : serviceState.status === "error" ? "Masa bilgisi alınamadı." : "Masa servisi kapalı."}</p>}
          <Link to="/admin/branches/tables">Masa planını aç <ArrowRight size={17} /></Link>
        </article>

        {/* Stok */}
        <article className="overview-insight stock">
          <div className="overview-insight-heading"><span>{stockReady && criticalCount === 0 ? <Check size={22} /> : <AlertTriangle size={22} />}</span><div><small>STOK</small><h3>{criticalCount === null ? "Stok durumu" : criticalCount > 0 ? `${criticalCount} kritik hammadde` : "Kritik uyarı yok"}</h3></div></div>
          {stockReady && stockHighlights.length > 0
            ? <div className="overview-insight-stock-list">{stockHighlights.map((item) =>
                <div key={item.id}>
                  <div className="stock-item-row"><strong>{item.name}</strong><small>−{item.belowThresholdBy} {item.unit}</small></div>
                  <div className="stock-mini-bar"><span style={{ width: `${Math.max(6, Math.round(item.onHand / Math.max(1, item.criticalBelow) * 100))}%` }} /></div>
                </div>
              )}</div>
            : <p className="overview-insight-message">{stockScopeMissing ? "Stokları görmek için şube seçin." : !stockReady ? criticalStockState.status === "loading" ? "Stoklar yükleniyor…" : "Stok bilgisi alınamadı." : "Eşik altında hammadde görünmüyor."}</p>}
          <Link to={stockLink}>{stockScopeMissing ? "Şubeleri aç" : "Stokları incele"} <ArrowRight size={17} /></Link>
        </article>
      </div>
    </section>

    {/* ━━━━ 4. HIZLI ERİŞİM: Yönetici kısayolları ━━━━ */}
    <section className="overview-spotlight-shortcuts" aria-label="Yönetim kısayolları"><span>HIZLI ERİŞİM</span><div>
      <Link to="/admin/catalog/products"><BookOpen size={18} /> Ürünler ve Menü <ArrowRight size={15} /></Link>
      <Link to="/admin/inventory/counts"><Boxes size={18} /> Stok ve Sayım <ArrowRight size={15} /></Link>
      <Link to="/admin/finance/expenses"><PlusCircle size={18} /> Gider Kaydet <ArrowRight size={15} /></Link>
      <Link to="/admin/customers/accounts"><UsersRound size={18} /> Cari ve Müşteriler <ArrowRight size={15} /></Link>
      <Link to="/admin/cash/movements"><Wallet size={18} /> Kasa Hareketleri <ArrowRight size={15} /></Link>
    </div></section>
  </main>;
}
