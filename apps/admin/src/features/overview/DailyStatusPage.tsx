import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  Clock,
  LayoutGrid,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { checks } from "../../data/catalog";
import { mockCriticalStock } from "./overview.fixtures";

/* ── Types ── */
type SalesOrder = {
  id: string;
  status: string;
  source: string;
  createdAt: string;
  totalMinor: number;
  items: Array<{ productName: string; quantity: number }>;
};
type SalesSummaryResponse = { items: SalesOrder[] };
type ServiceTable = {
  id: string;
  name: string;
  isActive: boolean;
  assignment: { orderStatus: string } | null;
};
type ServiceSummaryResponse = {
  tablesEnabled: boolean;
  waitersEnabled: boolean;
  items: ServiceTable[];
};
type CriticalStockItem = {
  id: string;
  name: string;
  onHand: number;
  criticalBelow: number;
  belowThresholdBy: number;
  unit: string;
};
type CriticalStockResponse = {
  source: "postgres";
  criticalCount: number;
  warehouseId: string;
  items: CriticalStockItem[];
};
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
type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error" };

/* ── API helper ── */
async function getApi<T>(path: string, actor: string): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  const response = await fetch(`${base}${path}`, {
    headers: { "X-Demo-Actor": actor },
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

/* ── Formatters ── */
const money = (minor: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(minor / 100);

const orderTime = (createdAt: string) =>
  new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(new Date(createdAt));

export function DailyStatusPage({ ctx }: { ctx: ViewContext }) {
  const branchId = ctx.selectedBranch?.apiId ?? null;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const salesHttp = import.meta.env.VITE_SALES_PROVIDER === "http";
  const serviceHttp = import.meta.env.VITE_SERVICE_PROVIDER === "http";
  const inventoryHttp = import.meta.env.VITE_INVENTORY_PROVIDER === "http";

  const [salesState, setSalesState] = useState<LoadState<SalesSummaryResponse>>({
    status: "loading",
  });
  const [serviceState, setServiceState] = useState<
    LoadState<ServiceSummaryResponse>
  >({ status: "loading" });
  const [criticalStockState, setCriticalStockState] = useState<
    LoadState<CriticalStockResponse>
  >({ status: "loading" });
  const [cashProfitState, setCashProfitState] = useState<
    LoadState<CashProfitResponse>
  >({ status: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);

  /* Fetch live operational data */
  useEffect(() => {
    let active = true;
    setSpinning(true);
    if (salesHttp) {
      setSalesState({ status: "loading" });
      const scope = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      void getApi<SalesSummaryResponse>(
        `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/sales/orders${scope}`,
        actor,
      )
        .then((d) => {
          if (active) setSalesState({ status: "ready", data: d });
        })
        .catch(() => {
          if (active) setSalesState({ status: "error" });
        });
    }
    if (serviceHttp && branchId) {
      setServiceState({ status: "loading" });
      void getApi<ServiceSummaryResponse>(
        `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/service/tables`,
        actor,
      )
        .then((d) => {
          if (active) setServiceState({ status: "ready", data: d });
        })
        .catch(() => {
          if (active) setServiceState({ status: "error" });
        });
    }
    if (inventoryHttp && branchId) {
      setCriticalStockState({ status: "loading" });
      void getApi<CriticalStockResponse>(
        `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/inventory/critical-stock`,
        actor,
      )
        .then((d) => {
          if (active) setCriticalStockState({ status: "ready", data: d });
        })
        .catch(() => {
          if (active) setCriticalStockState({ status: "error" });
        });
    }

    setCashProfitState({ status: "loading" });
    const cashProfitPath = branchId
      ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/cash-profit`
      : `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/overview/cash-profit`;
    void getApi<CashProfitResponse>(cashProfitPath, actor)
      .then((d) => {
        if (active) setCashProfitState({ status: "ready", data: d });
      })
      .catch(() => {
        if (active) setCashProfitState({ status: "error" });
      });

    const t = setTimeout(() => {
      if (active) setSpinning(false);
    }, 500);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [actor, branchId, ctx.firmId, inventoryHttp, salesHttp, serviceHttp, refreshKey]);

  /* Derived live data */
  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  const visibleChecks = checks.filter(
    (c) =>
      c.scenarioId === ctx.scenarioId &&
      (!ctx.selectedBranch || c.branchId === ctx.selectedBranch.id),
  );
  const openOrders =
    salesHttp && salesState.status === "ready"
      ? salesState.data.items.filter((o) => o.status === "open")
      : [];
  const salesCount = salesHttp
    ? salesState.status === "ready"
      ? openOrders.length
      : null
    : visibleChecks.length;
  const activeTables =
    serviceState.status === "ready" && branchId
      ? serviceState.data.items.filter((t) => t.isActive)
      : [];
  const serviceReady = Boolean(
    serviceHttp &&
      branchId &&
      serviceState.status === "ready" &&
      serviceState.data.tablesEnabled,
  );
  const occupied = serviceHttp
    ? serviceReady
      ? activeTables.filter((t) => t.assignment?.orderStatus === "open").length
      : null
    : branches.reduce((s, b) => s + b.occupied, 0);
  const tableCount = serviceHttp
    ? serviceReady
      ? activeTables.length
      : null
    : branches.reduce((s, b) => s + b.tables, 0);

  const stockScopeMissing = inventoryHttp && !branchId;
  const stockReady =
    !inventoryHttp || (!stockScopeMissing && criticalStockState.status === "ready");
  const criticalItems = inventoryHttp
    ? branchId && criticalStockState.status === "ready"
      ? criticalStockState.data.items
      : []
    : mockCriticalStock;
  const criticalCount = inventoryHttp
    ? branchId && criticalStockState.status === "ready"
      ? criticalStockState.data.criticalCount
      : null
    : mockCriticalStock.length;
  const stockHighlights = [...criticalItems]
    .sort(
      (a, b) =>
        b.belowThresholdBy / Math.max(b.criticalBelow, 1) -
        a.belowThresholdBy / Math.max(a.criticalBelow, 1),
    )
    .slice(0, 3);
  const stockLink = stockScopeMissing
    ? "/admin/branches/list"
    : "/admin/inventory/critical";
  const orderPreview = [...openOrders]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 4);

  const todayLabel = new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <main className="daily-status-page">
      {/* ━━━━ 1. BAŞLIK BÖLÜMÜ: SADECE BUGÜNÜN CANLI OPERASYONU ━━━━ */}
      <section className="daily-status-header-card">
        <div className="daily-status-header-top">
          <div className="daily-status-title-group">
            <span className="daily-status-badge">
              <Clock size={15} /> BUGÜNKÜ CANLI OPERASYON
            </span>
            <h1>Günün Operasyonel Durumu</h1>
            <p className="daily-status-meta">
              <strong>{ctx.selectedBranch?.name ?? ctx.firm}</strong> · {todayLabel}
            </p>
          </div>
          <div className="daily-status-actions">
            <button
              type="button"
              className={`overview-refresh-btn ${spinning ? "is-spinning" : ""}`}
              onClick={() => setRefreshKey((k) => k + 1)}
              title="Bugünkü verileri anlık yenile"
            >
              <RefreshCw size={15} /> Yenile
            </button>
            <Link to="/admin/overview" className="daily-to-overview-link">
              <Sparkles size={15} /> Genel Bakış'a Git <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {/* 4 Canlı Sayaç (Bugünün Anlık Durumu) */}
        <div className="daily-status-metrics-grid" aria-label="Günün anlık sayaçları">
          <Link to="/admin/sales/open" className="daily-metric-box">
            <span className="daily-metric-label">Açık Siparişler</span>
            <strong className="daily-metric-value">
              {salesCount === null ? "—" : salesCount}
            </strong>
            <span className="daily-metric-sub">
              İşlem bekleyen masalar/paketler <ArrowRight size={14} />
            </span>
          </Link>

          <Link to="/admin/branches/tables" className="daily-metric-box">
            <span className="daily-metric-label">Servisteki Masalar</span>
            <strong className="daily-metric-value">
              {occupied === null ? "—" : occupied}
              {tableCount !== null ? <small> / {tableCount}</small> : null}
            </strong>
            <span className="daily-metric-sub">
              Dolu masa doluluk durumu <ArrowRight size={14} />
            </span>
          </Link>

          <Link to={stockLink} className="daily-metric-box">
            <span className="daily-metric-label">Kritik Stok Uyarısı</span>
            <strong
              className="daily-metric-value"
              style={{ color: criticalCount && criticalCount > 0 ? "#b83824" : undefined }}
            >
              {criticalCount === null ? "—" : criticalCount}
            </strong>
            <span className="daily-metric-sub">
              Eşik altına düşen hammadde <ArrowRight size={14} />
            </span>
          </Link>

          <Link to="/admin/cash/movements" className="daily-metric-box">
            <span className="daily-metric-label">Açık Kasa Vardiyası</span>
            <strong className="daily-metric-value">
              {cashProfitState.status === "ready"
                ? `${cashProfitState.data.activeShiftsCount} Vardiya`
                : cashProfitState.status === "loading"
                  ? "…"
                  : "—"}
            </strong>
            <span className="daily-metric-sub">
              Günün açık kasa hareketleri <ArrowRight size={14} />
            </span>
          </Link>
        </div>
      </section>

      {/* ━━━━ 2. GÜNÜN GÜNDEMİ: CANLI OPERASYONEL İŞLER ━━━━ */}
      <section className="overview-spotlight-insights" id="daily-agenda" aria-labelledby="daily-agenda-title">
        <header>
          <div>
            <span className="overview-spotlight-section-label">BUGÜNÜN OPERASYONU</span>
            <h2 id="daily-agenda-title">Günün Canlı Gündemi</h2>
          </div>
          <p>Şu anda şubenizde işlem bekleyen canlı kayıtlar.</p>
        </header>

        <div className="overview-spotlight-insight-grid">
          {/* Siparişler */}
          <article className="overview-insight orders">
            <div className="overview-insight-heading">
              <span><ReceiptText size={22} /></span>
              <div>
                <small>AÇIK SİPARİŞLER</small>
                <h3>Son açık işler</h3>
              </div>
            </div>
            {salesHttp && salesState.status === "ready" && orderPreview.length > 0 ? (
              <div className="overview-insight-order-list">
                {orderPreview.slice(0, 3).map((order) => (
                  <div key={order.id}>
                    <span>
                      <strong>
                        {order.items[0]
                          ? `${order.items[0].quantity}× ${order.items[0].productName}`
                          : "Sipariş"}
                      </strong>
                      <small>
                        {orderTime(order.createdAt)} ·{" "}
                        {order.source === "test_pos" ? "Test POS" : "Servis"}
                      </small>
                    </span>
                    <b>{money(order.totalMinor)}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="overview-insight-message">
                {salesHttp && salesState.status === "error"
                  ? "Sipariş verisi alınamadı."
                  : salesHttp && salesState.status === "loading"
                    ? "Siparişler yükleniyor…"
                    : "Açık sipariş görünmüyor."}
              </p>
            )}
            <Link to="/admin/sales/open">
              Açık siparişleri gör <ArrowRight size={17} />
            </Link>
          </article>

          {/* Masalar */}
          <article className="overview-insight tables">
            <div className="overview-insight-heading">
              <span><LayoutGrid size={22} /></span>
              <div>
                <small>MASA SERVİSİ</small>
                <h3>
                  {occupied === null || tableCount === null
                    ? "Masa durumu"
                    : `${occupied} / ${tableCount} masa serviste`}
                </h3>
              </div>
            </div>
            {serviceReady ? (
              <div className="overview-insight-table-grid" aria-label="İlk 12 masanın durumu">
                {activeTables.slice(0, 12).map((table) => (
                  <span
                    className={table.assignment?.orderStatus === "open" ? "is-occupied" : ""}
                    key={table.id}
                    title={`${table.name}: ${table.assignment?.orderStatus === "open" ? "serviste" : "boş"}`}
                  >
                    {table.name.replace(/^Masa\s*/i, "")}
                  </span>
                ))}
              </div>
            ) : !serviceHttp ? (
              <div className="overview-insight-meter">
                <span
                  style={{
                    width: `${
                      tableCount && occupied !== null
                        ? Math.min(100, (occupied / tableCount) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            ) : (
              <p className="overview-insight-message">
                {!branchId
                  ? "Masaları görmek için şube seçin."
                  : serviceState.status === "loading"
                    ? "Masalar yükleniyor…"
                    : serviceState.status === "error"
                      ? "Masa bilgisi alınamadı."
                      : "Masa servisi kapalı."}
              </p>
            )}
            <Link to="/admin/branches/tables">
              Masa planını aç <ArrowRight size={17} />
            </Link>
          </article>

          {/* Stok */}
          <article className="overview-insight stock">
            <div className="overview-insight-heading">
              <span>
                {stockReady && criticalCount === 0 ? (
                  <Check size={22} />
                ) : (
                  <AlertTriangle size={22} />
                )}
              </span>
              <div>
                <small>STOK UYARILARI</small>
                <h3>
                  {criticalCount === null
                    ? "Stok durumu"
                    : criticalCount > 0
                      ? `${criticalCount} kritik hammadde`
                      : "Kritik uyarı yok"}
                </h3>
              </div>
            </div>
            {stockReady && stockHighlights.length > 0 ? (
              <div className="overview-insight-stock-list">
                {stockHighlights.map((item) => (
                  <div key={item.id}>
                    <div className="stock-item-row">
                      <strong>{item.name}</strong>
                      <small>
                        −{item.belowThresholdBy} {item.unit}
                      </small>
                    </div>
                    <div className="stock-mini-bar">
                      <span
                        style={{
                          width: `${Math.max(
                            6,
                            Math.round(
                              (item.onHand / Math.max(1, item.criticalBelow)) * 100,
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="overview-insight-message">
                {stockScopeMissing
                  ? "Stokları görmek için şube seçin."
                  : !stockReady
                    ? criticalStockState.status === "loading"
                      ? "Stoklar yükleniyor…"
                      : "Stok bilgisi alınamadı."
                    : "Eşik altında hammadde görünmüyor."}
              </p>
            )}
            <Link to={stockLink}>
              {stockScopeMissing ? "Şubeleri aç" : "Stokları incele"}{" "}
              <ArrowRight size={17} />
            </Link>
          </article>

          {/* Kasa Durumu */}
          <article className="overview-insight cash-profit">
            <div className="overview-insight-heading">
              <span><Wallet size={22} /></span>
              <div>
                <small>KASALAR & GİRİŞ-ÇIKIŞ</small>
                <h3>
                  {cashProfitState.status === "ready"
                    ? `${cashProfitState.data.activeShiftsCount} Açık Kasa`
                    : cashProfitState.status === "loading"
                      ? "Kasalar yükleniyor…"
                      : "Kasa durumu"}
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
                  <strong style={{ color: "#a83e32" }}>
                    −{money(cashProfitState.data.totalCashOutMinor)}
                  </strong>
                </div>
                <div className="overview-cash-metric-row">
                  <span>Net Kasa Durumu:</span>
                  <strong
                    className={
                      cashProfitState.data.netProfitMinor >= 0
                        ? "is-profit"
                        : "is-loss"
                    }
                  >
                    {cashProfitState.data.netProfitMinor >= 0 ? "+" : ""}
                    {money(cashProfitState.data.netProfitMinor)}
                  </strong>
                </div>

                {cashProfitState.data.registers.length > 0 && (
                  <div className="overview-cash-registers-mini">
                    {cashProfitState.data.registers.map((reg) => (
                      <div
                        key={reg.id}
                        className="overview-cash-reg-item"
                        title={`${reg.name}: Giriş ${money(reg.cashInMinor)}, Çıkış ${money(reg.cashOutMinor)}`}
                      >
                        <span>
                          {reg.name.replace(/^Kadıköy\s*/i, "")} ({reg.code})
                        </span>
                        <b>
                          {reg.hasOpenShift ? "Açık" : "Kapalı"}
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
                  : "Kasa durumu alınamadı."}
              </p>
            )}
            <Link to="/admin/cash/movements">
              Kasa hareketlerini incele <ArrowRight size={17} />
            </Link>
          </article>
        </div>
      </section>

      {/* ━━━━ 3. BUGÜNKÜ HIZLI İŞLEMLER ━━━━ */}
      <section className="overview-spotlight-shortcuts" aria-label="Günün kısayolları">
        <span>GÜNÜN HIZLI İŞLEMLERİ</span>
        <div>
          <Link to="/admin/sales/open">
            <ReceiptText size={18} /> Açık Siparişleri Gör <ArrowRight size={15} />
          </Link>
          <Link to="/admin/branches/tables">
            <LayoutGrid size={18} /> Masa Servis Planı <ArrowRight size={15} />
          </Link>
          <Link to="/admin/inventory/receiving">
            <Boxes size={18} /> Mal Kabul Kaydet <ArrowRight size={15} />
          </Link>
          <Link to="/admin/cash/movements">
            <Wallet size={18} /> Kasa Hareketi Ekle <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </main>
  );
}
