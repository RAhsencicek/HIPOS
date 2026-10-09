import { AlertTriangle, ArrowRight, Boxes, BookOpen, LayoutGrid, ReceiptText, Settings2, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { checks } from "../../data/catalog";
import { MetricCard, PageHeading, StatusPill } from "../../shared/ui";
import { mockCriticalStock } from "./overview.fixtures";

type SalesOrder = { status: string };
type SalesSummaryResponse = { items: SalesOrder[] };
type ServiceSummaryResponse = {
  tablesEnabled: boolean;
  waitersEnabled: boolean;
  items: Array<{ isActive: boolean; assignment: { orderStatus: string } | null }>;
};
type CriticalStockItem = { id: string; name: string; onHand: number; criticalBelow: number; belowThresholdBy: number; unit: string };
type CriticalStockResponse = { source: "postgres"; criticalCount: number; warehouseId: string; items: CriticalStockItem[] };
type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

async function getApi<T>(path: string, actor: string): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180";
  const response = await fetch(`${base}${path}`, { headers: { "X-Demo-Actor": actor } });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export function Dashboard({ ctx }: { ctx: ViewContext }) {
  const branchId = ctx.selectedBranch?.apiId ?? null;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const salesHttp = import.meta.env.VITE_SALES_PROVIDER === "http";
  const serviceHttp = import.meta.env.VITE_SERVICE_PROVIDER === "http";
  const inventoryHttp = import.meta.env.VITE_INVENTORY_PROVIDER === "http";
  const [salesState, setSalesState] = useState<LoadState<SalesSummaryResponse>>({ status: "loading" });
  const [serviceState, setServiceState] = useState<LoadState<ServiceSummaryResponse>>({ status: "loading" });
  const [criticalStockState, setCriticalStockState] = useState<LoadState<CriticalStockResponse>>({ status: "loading" });

  useEffect(() => {
    let active = true;
    if (salesHttp) {
      setSalesState({ status: "loading" });
      const scope = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      void getApi<SalesSummaryResponse>(`/api/v1/firms/${encodeURIComponent(ctx.firmId)}/sales/orders${scope}`, actor)
        .then((data) => { if (active) setSalesState({ status: "ready", data }); })
        .catch(() => { if (active) setSalesState({ status: "error" }); });
    }
    if (serviceHttp && branchId) {
      setServiceState({ status: "loading" });
      void getApi<ServiceSummaryResponse>(`/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/service/tables`, actor)
        .then((data) => { if (active) setServiceState({ status: "ready", data }); })
        .catch(() => { if (active) setServiceState({ status: "error" }); });
    }
    if (inventoryHttp && branchId) {
      setCriticalStockState({ status: "loading" });
      void getApi<CriticalStockResponse>(`/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/inventory/critical-stock`, actor)
        .then((data) => { if (active) setCriticalStockState({ status: "ready", data }); })
        .catch(() => { if (active) setCriticalStockState({ status: "error" }); });
    }
    return () => { active = false; };
  }, [actor, branchId, ctx.firmId, inventoryHttp, salesHttp, serviceHttp]);

  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  const visibleChecks = checks.filter((check) => check.scenarioId === ctx.scenarioId &&
    (!ctx.selectedBranch || check.branchId === ctx.selectedBranch.id));
  const activeServiceTables = serviceState.status === "ready"
    ? serviceState.data.items.filter((table) => table.isActive)
    : [];
  // DemoCheck fixtures represent only currently open checks.
  const mockOpenChecks = visibleChecks.length;
  const salesCount = salesHttp
    ? salesState.status === "ready" ? salesState.data.items.filter((order) => order.status === "open").length : null
    : mockOpenChecks;
  const occupied = serviceHttp
    ? serviceState.status === "ready" && serviceState.data.tablesEnabled
      ? activeServiceTables.filter((table) => table.assignment?.orderStatus === "open").length
      : null
    : branches.reduce((sum, branch) => sum + branch.occupied, 0);
  const tableCount = serviceHttp
    ? serviceState.status === "ready" && serviceState.data.tablesEnabled ? activeServiceTables.length : null
    : branches.reduce((sum, branch) => sum + branch.tables, 0);
  const salesFoot = salesHttp
    ? salesState.status === "ready" ? "Açık · son 100 sipariş" : salesState.status === "loading" ? "Yükleniyor" : "API bağlantısı yok"
    : "Açık · örnek kayıt";
  const tableFoot = serviceHttp
    ? serviceState.status === "ready"
      ? serviceState.data.tablesEnabled ? "Açık masa-adisyon bağları" : "Masa servisi kapalı"
      : serviceState.status === "loading" ? "Yükleniyor" : "API bağlantısı yok"
    : "Örnek gösterim";
  const criticalItems = inventoryHttp
    ? criticalStockState.status === "ready" ? criticalStockState.data.items : []
    : mockCriticalStock;
  const criticalCount = inventoryHttp
    ? criticalStockState.status === "ready" ? criticalStockState.data.criticalCount : null
    : mockCriticalStock.length;
  const todayLabel = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return <>
    <PageHeading eyebrow="YÖNETİCİ BAŞLANGIÇ EKRANI" title="Günlük Durum"
      description={`${ctx.selectedBranch?.name ?? ctx.firm} · Bugün için operasyon özeti ve dikkat gerektiren işler.`}
      action={<div className="daily-page-actions"><StatusPill tone="blue">Yönetici görünümü</StatusPill><time dateTime={new Date().toISOString()}>{todayLabel}</time></div>} />
    <section className="manager-summary" aria-label="İşletme özeti">
      <MetricCard title="AÇIK ADİSYONLAR" value={salesCount === null ? "—" : String(salesCount)}
        foot={salesHttp && salesState.status === "ready" ? "Son 100 sipariş içindeki açıklar" : salesFoot} icon={<ReceiptText size={22} />} tone="blue" to="/admin/sales/open" />
      <MetricCard title="MASA SERVİSİ" value={occupied === null || tableCount === null ? "—" : `${occupied} / ${tableCount}`}
        foot={tableFoot} icon={<LayoutGrid size={22} />} tone="purple" to="/admin/branches/tables" />
      <MetricCard title="KRİTİK HAMMADDE" value={criticalCount === null ? "—" : String(criticalCount)}
        foot={inventoryHttp ? criticalStockState.status === "ready" ? "Inventory API · seçili depo" : criticalStockState.status === "loading" ? "Yükleniyor" : "Inventory API bağlantısı yok" : "Örnek gösterim"}
        icon={<AlertTriangle size={22} />} tone="orange" to="/admin/inventory/critical" />
    </section>

    <section className="manager-home-section" aria-labelledby="critical-stock-title">
      <div className="manager-section-heading"><div><span className="card-kicker">STOK UYARISI</span><h2 id="critical-stock-title">Kritik stoklar</h2></div>
        <span>{inventoryHttp ? "Inventory API" : "Örnek gösterim"}</span></div>
      {inventoryHttp && criticalStockState.status === "error" && <div className="notice" role="alert">Kritik stok verisi inventory API'sinden alınamadı; örnek veriyle gizlenmedi.</div>}
      {criticalItems.length > 0 ? <div className="card manager-critical-card">
        <div className="manager-critical-heading"><div><AlertTriangle size={19} /><span>{criticalCount} hammadde eşik altında</span></div>
          <Link className="text-link" to="/admin/inventory/critical">Kritik stokların tümü <ArrowRight size={15} /></Link></div>
        <div className="table-scroll"><table className="manager-critical-table"><thead><tr><th>HAMMADDE</th><th>MEVCUT / KRİTİK EŞİK</th><th>EŞİK ALTINDA</th><th>DURUM</th></tr></thead>
          <tbody>{criticalItems.map((item) => <tr key={item.id}><td><span className="critical-item-name"><AlertTriangle size={15} /><strong>{item.name}</strong></span></td>
            <td><strong>{item.onHand} {item.unit}</strong><small>Kritik eşik: {item.criticalBelow} {item.unit}</small></td>
            <td><strong className="critical-shortage">−{item.belowThresholdBy} {item.unit}</strong></td>
            <td><StatusPill tone="orange">Kritik</StatusPill></td></tr>)}</tbody></table></div>
      </div> : inventoryHttp && criticalStockState.status === "ready"
        ? <div className="card generic-empty manager-no-critical"><span>✓</span><div><strong>Kritik stok uyarısı yok</strong><small>Seçili depoda tüm hammaddeler kritik eşik üzerinde.</small></div></div>
        : null}
    </section>

    <section className="manager-home-section" aria-labelledby="manager-shortcuts-title">
      <div className="manager-section-heading"><div><span className="card-kicker">İLK ADIMLAR</span><h2 id="manager-shortcuts-title">Yönetim kısayolları</h2></div>
        <span>Temel işletme işleri</span></div>
      <div className="manager-shortcuts">
        <Link className="card manager-shortcut" to="/admin/catalog/products"><BookOpen size={21} /><span><strong>Ürünler ve fiyatlar</strong><small>Ürünleri, fiyatı ve menü yayını incele</small></span><ArrowRight size={16} /></Link>
        <Link className="card manager-shortcut" to="/admin/customers/accounts"><UsersRound size={21} /><span><strong>Müşteri ve tedarikçi</strong><small>Cari kartları ve hesap hareketleri</small></span><ArrowRight size={16} /></Link>
        <Link className="card manager-shortcut" to="/admin/inventory/counts"><Boxes size={21} /><span><strong>Stok, reçete ve sayım</strong><small>{inventoryHttp ? "PostgreSQL'e bağlı temel işlemler" : "Kurgusal demo verisi"}</small><StatusPill tone={inventoryHttp ? "green" : "orange"}>{inventoryHttp ? "HTTP · PostgreSQL" : "Örnek gösterim"}</StatusPill></span><ArrowRight size={16} /></Link>
        <Link className="card manager-shortcut" to="/admin/settings/modules"><Settings2 size={21} /><span><strong>Özellikleri yönet</strong><small>Şubede hangi modüller açık?</small></span><ArrowRight size={16} /></Link>
      </div>
    </section>

    <section className="manager-home-section" aria-labelledby="manager-updates-title">
      <div className="manager-section-heading"><div><span className="card-kicker">DUYURULAR</span><h2 id="manager-updates-title">Yenilikler ve sıradaki işler</h2></div>
        <span>Ürün durumu</span></div>
      <div className="card manager-updates">
        <div><StatusPill tone="green">Eklendi</StatusPill><span><strong>Masa planında adisyon ayrıntısı</strong><small>Masaya tıklayınca sipariş kalemleri ve servis sorumlusu görüntülenir.</small></span><Link to="/admin/branches/tables" aria-label="Masa planına git"><ArrowRight size={16} /></Link></div>
        <div><StatusPill tone="green">Eklendi</StatusPill><span><strong>Stok, reçete ve sayım temeli</strong><small>Kritik eşikler, hareket defteri, teorik üretim tahmini ve depo kapsamlı sayım API'ye bağlandı. Satın alma emri ve barkod sonraki işlerdir.</small></span><Link to="/admin/inventory/summary" aria-label="Stok özetine git"><ArrowRight size={16} /></Link></div>
      </div>
    </section>
  </>;
}
