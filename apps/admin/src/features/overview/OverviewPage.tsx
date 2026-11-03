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
  UsersRound,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { checks } from "../../data/catalog";
import { mockCriticalStock } from "./overview.fixtures";

/* ── Types ── */
type TopDishItem = {
  rank: number;
  productId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  isDish: boolean;
  soldCount: number;
  totalRevenueMinor: number;
  currency: string;
  imageUrl: string;
  emoji: string;
};
type TopDishesResponse = {
  source: "postgres";
  firmId: string;
  branchId: string | null;
  category: string;
  totalSold: number;
  items: TopDishItem[];
};

type SalesOrder = { id: string; status: string; source: string; createdAt: string; totalMinor: number; items: Array<{ productName: string; quantity: number }> };
type SalesSummaryResponse = { items: SalesOrder[] };
type ServiceTable = { id: string; name: string; isActive: boolean; assignment: { orderStatus: string } | null };
type ServiceSummaryResponse = { tablesEnabled: boolean; waitersEnabled: boolean; items: ServiceTable[] };
type CriticalStockItem = { id: string; name: string; onHand: number; criticalBelow: number; belowThresholdBy: number; unit: string };
type CriticalStockResponse = { source: "postgres"; criticalCount: number; warehouseId: string; items: CriticalStockItem[] };
type CashProfitRegister = {
  id: string;
  code: string;
  name: string;
  cashInMinor: number;
  cashOutMinor: number;
  netProfitMinor: number;
  profitRate: number;
  hasOpenShift: boolean;
};
type CashProfitResponse = {
  source: "postgres";
  totalRegisters: number;
  activeShiftsCount: number;
  totalCashInMinor: number;
  totalCashOutMinor: number;
  netProfitMinor: number;
  profitRate: number;
  openShiftInMinor: number;
  openShiftOutMinor: number;
  openShiftNetProfitMinor: number;
  openShiftProfitRate: number;
  registers: CashProfitRegister[];
};
type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

/* ── API helper ── */
async function getApi<T>(path: string, actor: string): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
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

  const [salesState, setSalesState] = useState<LoadState<SalesSummaryResponse>>({ status: "loading" });
  const [serviceState, setServiceState] = useState<LoadState<ServiceSummaryResponse>>({ status: "loading" });
  const [criticalStockState, setCriticalStockState] = useState<LoadState<CriticalStockResponse>>({ status: "loading" });
  const [cashProfitState, setCashProfitState] = useState<LoadState<CashProfitResponse>>({ status: "loading" });
  const [topDishesState, setTopDishesState] = useState<LoadState<TopDishesResponse>>({ status: "loading" });
  const [dishesCategory, setDishesCategory] = useState<"food" | "all">("food");

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
        setCashProfitState({ status: "loading" });
    const cashProfitPath = branchId
      ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/cash-profit`
      : `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/overview/cash-profit`;
    void getApi<CashProfitResponse>(cashProfitPath, actor)
      .then((d) => { if (active) setCashProfitState({ status: "ready", data: d }); })
      .catch(() => { if (active) setCashProfitState({ status: "error" }); });
    setTopDishesState({ status: "loading" });
    const topDishesPath = branchId
      ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/top-dishes?category=${dishesCategory}`
      : `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/overview/top-dishes?category=${dishesCategory}`;
    void getApi<TopDishesResponse>(topDishesPath, actor)
      .then((d) => { if (active) setTopDishesState({ status: "ready", data: d }); })
      .catch(() => { if (active) setTopDishesState({ status: "error" }); });
    const t = setTimeout(() => { if (active) setSpinning(false); }, 500);
    return () => { active = false; clearTimeout(t); };
  }, [actor, branchId, ctx.firmId, inventoryHttp, salesHttp, serviceHttp, refreshKey, dishesCategory]);

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

  /* Chart */
  const chartOrders = salesHttp && salesState.status === "ready" ? salesState.data.items : [];
  const totalsByDay = new Map<string, { total: number; count: number }>();
  chartOrders.forEach((order) => {
    const key = istanbulDay(new Date(order.createdAt));
    const cur = totalsByDay.get(key) ?? { total: 0, count: 0 };
    totalsByDay.set(key, { total: cur.total + order.totalMinor, count: cur.count + 1 });
  });
  // Sadece önceki 3 işlem gününün cirosu
  const chartDays = [...totalsByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-3)
    .map(([key, val]) => ({
      key,
      label: new Intl.DateTimeFormat("tr-TR", {
        day: "numeric",
        month: "short",
        timeZone: "Europe/Istanbul",
      }).format(new Date(`${key}T12:00:00+03:00`)),
      ...val,
    }));
  const chartMax = Math.max(1, ...chartDays.map((d) => d.total));
  const chartTotal = chartDays.reduce((s, d) => s + d.total, 0);
  const chartCount = chartDays.reduce((s, d) => s + d.count, 0);

  /* Greeting */
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Istanbul" }).format(new Date()));
  const greeting = hour < 11 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const todayLabel = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const personalSummary = !salesHttp ? "Giriş yaptığınızda veriler burada özetlenecek."
    : salesHttp && salesState.status === "loading" ? "İşletmenizin güncel kayıtları hazırlanıyor."
    : `Şu anda ${salesCount ?? 0} açık ${salesHttp ? "sipariş" : "adisyon"} var${occupied !== null ? `, ${occupied} masa serviste` : ""}.${criticalCount && criticalCount > 0 ? ` ${criticalCount} kritik stok kalemi ilginizi bekliyor.` : ""}${cashProfitState.status === "ready" ? ` Kasa kar oranı %${cashProfitState.data.profitRate}.` : ""}`;

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
            <Link to="/admin/cash/movements" title="Kasa kar oranı ve detayları">
              <strong>
                {cashProfitState.status === "ready" ? `%${cashProfitState.data.profitRate}` : cashProfitState.status === "loading" ? "…" : "—"}
              </strong>
              <span>Kasa kar oranı</span>
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="overview-spotlight-bottom"><span><CalendarDays size={17} /> {todayLabel}</span><Link to={priorityLink}>{priorityLabel} <ArrowRight size={17} /></Link></div>
        </div>

        <Link
          to="/admin/overview/turnover"
          className="overview-spotlight-chart"
          title="Her ayın her gününe ait ciroları detaylı görmek için tıklayın"
        >
          <div className="overview-chart-heading">
            <span className="overview-chart-icon">
              <ReceiptText size={23} />
            </span>
            <div>
              <span>SİPARİŞ RİTMİ</span>
              <h2>Önceki 3 günün cirosu</h2>
            </div>
            <span className="overview-chart-period">
              {chartDays.length ? `${chartDays.length} GÜN` : "3 GÜN"}
            </span>
          </div>
          <div className="overview-chart-total">
            <strong>
              {salesHttp && salesState.status === "ready"
                ? money(chartTotal)
                : "—"}
            </strong>
            <span>
              {salesHttp && salesState.status === "ready"
                ? `Son 3 işlem gününün toplam işlem hacmi (${chartCount} sipariş)`
                : "Sipariş kayıtları yükleniyor…"}
            </span>
          </div>
          {chartDays.length ? (
            <div
              className="overview-chart-bars"
              style={{
                gridTemplateColumns: `repeat(${chartDays.length},minmax(0,1fr))`,
              }}
              role="img"
              aria-label={`${chartCount} sipariş, toplam ${money(chartTotal)}`}
            >
              {chartDays.map((day) => (
                <div
                  className="overview-chart-day"
                  key={day.key}
                  title={`${day.label}: ${day.count} sipariş · ${money(day.total)}`}
                >
                  <strong className="overview-day-turnover">
                    {money(day.total)}
                  </strong>
                  <span className="overview-chart-bar-track">
                    <i
                      className="has-orders"
                      style={{
                        height: `${Math.max(16, (day.total / chartMax) * 100)}%`,
                      }}
                    />
                  </span>
                  <small className="overview-day-date">{day.label}</small>
                  <span className="overview-day-orders">
                    {day.count} sipariş
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="overview-chart-empty">
              {salesHttp && salesState.status === "error"
                ? "Sipariş bilgisi alınamadı."
                : salesHttp && salesState.status === "loading"
                  ? "Grafik hazırlanıyor…"
                  : "Henüz grafik oluşturacak sipariş kaydı yok."}
            </div>
          )}
          <div className="overview-chart-footer">
            <span>
              <i /> Günlük sipariş cirosu
            </span>
            <span className="overview-chart-action">
              Tüm Günlük Cirolar <ArrowRight size={13} />
            </span>
          </div>
        </Link>
      </div>
    </section>

        {/* ━━━━ 2. LEZZETLER & MENÜ PERFORMANSI: EN ÇOK SATAN YİYECEKLER ━━━━ */}
    <section className="overview-dishes-section" aria-labelledby="overview-top-dishes-title">
      <header className="overview-dishes-section-header">
        <div>
          <span className="overview-spotlight-section-label"><UtensilsCrossed size={16} /> MENÜ ANALİTİĞİ</span>
          <h2 id="overview-top-dishes-title">Popüler Lezzetler & Ürünler</h2>
        </div>
        <p>İşletmenizin tüm siparişlerindeki satış hacmine göre ürün sıralaması.</p>
      </header>

      <div className="overview-dishes-grid">
        {/* Sol Kolon: Top Selling Dishes (Görsel Referansı İle Birebir Kart) */}
        <div className="overview-top-dishes-card">
          <div className="overview-top-dishes-header">
            <div>
              <h3 className="overview-top-dishes-heading">Top Selling Dishes</h3>
              <span className="overview-top-dishes-sub">En çok satan lezzetler</span>
            </div>
            <div className="overview-dishes-filter-pill" role="tablist" aria-label="Menü filtresi">
              <button
                type="button"
                role="tab"
                aria-selected={dishesCategory === "food"}
                className={dishesCategory === "food" ? "is-active" : ""}
                onClick={() => setDishesCategory("food")}
              >
                🍕 Yiyecekler
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={dishesCategory === "all"}
                className={dishesCategory === "all" ? "is-active" : ""}
                onClick={() => setDishesCategory("all")}
              >
                Tüm Menü
              </button>
            </div>
          </div>

          {topDishesState.status === "ready" && topDishesState.data.items.length > 0 ? (
            <div className="overview-top-dishes-list" role="list">
              {topDishesState.data.items.map((dish) => (
                <div key={dish.productId} className="overview-top-dish-row" role="listitem">
                  <span className="overview-top-dish-rank">{dish.rank}.</span>
                  <div className="overview-top-dish-thumb-wrap">
                    <img
                      src={dish.imageUrl}
                      alt={dish.name}
                      className="overview-top-dish-thumb"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        const fallback = e.currentTarget.parentElement?.querySelector(".overview-dish-thumb-emoji");
                        if (fallback) (fallback as HTMLElement).style.display = "grid";
                      }}
                    />
                    <span className="overview-dish-thumb-emoji" aria-hidden="true" style={{ display: "none" }}>
                      {dish.emoji || "🍽️"}
                    </span>
                  </div>
                  <div className="overview-top-dish-info">
                    <strong className="overview-top-dish-name" title={dish.name}>
                      {dish.name}
                    </strong>
                    <span className="overview-top-dish-sold">
                      {dish.soldCount} sold ({dish.soldCount} adet satıldı)
                    </span>
                  </div>
                  <div className="overview-top-dish-rev" title="Toplam ciro katkısı">
                    <span>{money(dish.totalRevenueMinor)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : topDishesState.status === "loading" ? (
            <div className="overview-top-dishes-loading">
              <p>Lezzet sıralaması hesaplanıyor…</p>
            </div>
          ) : (
            <div className="overview-top-dishes-empty">
              <p>Henüz sipariş kaydı bulunmuyor.</p>
            </div>
          )}
        </div>

        {/* Sağ Kolon: Menü Dağılımı & Hızlı Özet */}
        <div className="overview-dishes-summary-card">
          <div className="overview-dishes-summary-header">
            <span className="overview-summary-badge"><TrendingUp size={16} /> Satış Paylaşımı</span>
            <h3>Menü & Kategori Durumu</h3>
            <p>Satış adetlerinin menü gruplarına dağılımı ve hızlı katalog yönetimi.</p>
          </div>

          <div className="overview-dishes-summary-stats">
            <div className="overview-summary-stat-box">
              <span className="stat-label">Toplam Satış</span>
              <strong className="stat-value">
                {topDishesState.status === "ready" ? `${topDishesState.data.totalSold} Adet` : "—"}
              </strong>
              <small className="stat-hint">
                {dishesCategory === "food" ? "Yiyecek ve tatlı porsiyonu" : "Tüm menü kalemleri"}
              </small>
            </div>
            <div className="overview-summary-stat-box">
              <span className="stat-label">Lider Lezzet</span>
              <strong className="stat-value">
                {topDishesState.status === "ready" && topDishesState.data.items[0]
                  ? topDishesState.data.items[0].name
                  : "—"}
              </strong>
              <small className="stat-hint">
                {topDishesState.status === "ready" && topDishesState.data.items[0]
                  ? `${topDishesState.data.items[0].soldCount} adet satıldı`
                  : "Sipariş verisi"}
              </small>
            </div>
          </div>

          <div className="overview-dishes-summary-links">
            <Link to="/admin/catalog/products" className="overview-dish-action-link">
              <BookOpen size={16} /> Ürünleri ve Fiyatları Yönet <ArrowRight size={15} />
            </Link>
            <Link to="/admin/catalog/menus" className="overview-dish-action-link">
              <Sparkles size={16} /> Menü ve Kategori Sıralaması <ArrowRight size={15} />
            </Link>
          </div>
        </div>
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
        {/* Kasalar ve Kârlılık */}
        <article className="overview-insight cash-profit">
          <div className="overview-insight-heading">
            <span><Wallet size={22} /></span>
            <div>
              <small>KASALAR & KÂRLILIK</small>
              <h3>
                {cashProfitState.status === "ready"
                  ? `Toplam %${cashProfitState.data.profitRate} Kâr`
                  : cashProfitState.status === "loading"
                    ? "Kasa kârı hesaplanıyor…"
                    : "Kasa kâr durumu"}
              </h3>
            </div>
          </div>

          {cashProfitState.status === "ready" ? (
            <div className="overview-insight-cash-list">
              <div className="overview-cash-metric-row">
                <span>Toplam Kasa Girişi:</span>
                <strong>{money(cashProfitState.data.totalCashInMinor)}</strong>
              </div>
              <div className="overview-cash-metric-row">
                <span>Toplam Kasa Çıkışı:</span>
                <strong style={{ color: "#a83e32" }}>−{money(cashProfitState.data.totalCashOutMinor)}</strong>
              </div>
              <div className="overview-cash-metric-row">
                <span>Net Kasa Kârı:</span>
                <strong className={cashProfitState.data.netProfitMinor >= 0 ? "is-profit" : "is-loss"}>
                  {cashProfitState.data.netProfitMinor >= 0 ? "+" : ""}{money(cashProfitState.data.netProfitMinor)}
                </strong>
              </div>

              {cashProfitState.data.registers.length > 0 && (
                <div className="overview-cash-registers-mini">
                  {cashProfitState.data.registers.map((reg) => (
                    <div key={reg.id} className="overview-cash-reg-item" title={`${reg.name}: Giriş ${money(reg.cashInMinor)}, Çıkış ${money(reg.cashOutMinor)}`}>
                      <span>{reg.name.replace(/^Kadıköy\s*/i, "")} ({reg.code})</span>
                      <b>
                        {reg.cashInMinor > 0 ? `%${reg.profitRate} kâr` : reg.cashOutMinor > 0 ? `−${money(reg.cashOutMinor)}` : "Hareketsiz"}
                      </b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="overview-insight-message">
              {cashProfitState.status === "loading"
                ? "Kasa kayıtları yükleniyor…"
                : "Kasa kârlılık verisi alınamadı."}
            </p>
          )}
          <Link to="/admin/cash/movements">Kasa hareketlerini incele <ArrowRight size={17} /></Link>
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
