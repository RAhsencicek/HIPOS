import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  ExternalLink,
  Filter,
  Info,
  LayoutGrid,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { PageHeading, StatusPill } from "../../shared/ui";

/* ── Types ── */
export type AlertSeverity = "critical" | "warning" | "info";
export type AlertCategory = "inventory" | "sales" | "tables" | "cash" | "kitchen";

export type OperationAlert = {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  detail?: string;
  timestamp: string;
  timeAgo: string;
  actionText: string;
  actionLink: string;
  isExternalLink?: boolean;
};

type CriticalStockItem = {
  id: string;
  name: string;
  unit: string;
  criticalBelow: number;
  onHand: number;
  belowThresholdBy: number;
};

type CriticalStockResponse = {
  criticalCount: number;
  items: CriticalStockItem[];
};

type ServiceTable = {
  id: string;
  name: string;
  number: number;
  isActive: boolean;
  assignment?: {
    waiterName: string;
    openedAt: string;
    totalMinor: number;
    items?: Array<{ productName: string; quantity: number }>;
  };
};

type TablesResponse = {
  items: ServiceTable[];
};

type CashResponse = {
  openShifts: Array<{
    shift: {
      status: string;
      expectedCashMinor?: number;
      openingCashMinor: number;
      openedAt: string;
    };
    cashInMinor: number;
    cashOutMinor: number;
  }>;
};

type KitchenResponse = {
  items: Array<{
    id: string;
    status: string;
    productName: string;
    quantity: number;
    submittedAt: string;
  }>;
};

type AcknowledgedAlertRecord = {
  alertKey: string;
  category: string;
  title: string;
  actor: string;
  note?: string;
  acknowledgedAt: string;
};

type OverviewAlertsApiResponse = {
  source: string;
  branchId: string;
  acknowledged: AcknowledgedAlertRecord[];
};

/* ── Formatters ── */
const money = (minor: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(minor / 100);

const calcMinutesAgo = (isoDate: string) => {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.max(1, Math.round(diffMs / (1000 * 60)));
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
};

export function AlertsPage({ ctx }: { ctx: ViewContext }) {
  const branchId = ctx.selectedBranch?.apiId ?? null;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";

  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Raw API items
  const [criticalStock, setCriticalStock] = useState<CriticalStockItem[]>([]);
  const [tables, setTables] = useState<ServiceTable[]>([]);
  const [cashData, setCashData] = useState<CashResponse | null>(null);
  const [kitchenTasks, setKitchenTasks] = useState<KitchenResponse["items"]>([]);

  // View mode: 'active' (aktife odaklan, incelenenler gizli) vs 'archived' (incelenenler arşivi)
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");

  // Filtering & Interactions
  const [severityFilter, setSeverityFilter] = useState<"all" | AlertSeverity>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | AlertCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [ackMap, setAckMap] = useState<Map<string, AcknowledgedAlertRecord>>(new Map());

  // localStorage persistence & fallback: Sayfa yenilense de incelenenler kaybolmaz
  const storageKey = `hipos_alerts_dismissed_${ctx.firmId}_${branchId ?? "all"}`;
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const saveDismissed = useCallback(
    (newSet: Set<string>) => {
      setDismissedIds(newSet);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...newSet]));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  /* Load Live Data across multiple subsystems */
  const loadAlertsData = useCallback(async () => {
    setLoading(true);
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    const headers = { "X-Demo-Actor": actor };

    try {
      // 1. Critical Stock
      if (branchId) {
        try {
          const res = await fetch(
            `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/inventory/critical-stock`,
            { headers }
          );
          if (res.ok) {
            const data = (await res.json()) as CriticalStockResponse;
            setCriticalStock(data.items ?? []);
          }
        } catch {
          // ignore
        }

        // 2. Tables & Service
        try {
          const res = await fetch(
            `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/service/tables`,
            { headers }
          );
          if (res.ok) {
            const data = (await res.json()) as TablesResponse;
            setTables(data.items ?? []);
          }
        } catch {
          // ignore
        }

        // 3. Cash Shifts
        try {
          const res = await fetch(
            `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/cash/overview`,
            { headers }
          );
          if (res.ok) {
            const data = (await res.json()) as CashResponse;
            setCashData(data);
          }
        } catch {
          // ignore
        }

        // 4. Kitchen tasks
        try {
          const res = await fetch(
            `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/kitchen/tasks?status=active`,
            { headers }
          );
          if (res.ok) {
            const data = (await res.json()) as KitchenResponse;
            setKitchenTasks(data.items ?? []);
          }
        } catch {
          // ignore
        }

        // 5. Backend Persisted Acknowledgments
        try {
          const res = await fetch(
            `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/alerts`,
            { headers }
          );
          if (res.ok) {
            const data = (await res.json()) as OverviewAlertsApiResponse;
            const map = new Map<string, AcknowledgedAlertRecord>();
            const set = new Set<string>();
            (data.acknowledged ?? []).forEach((item) => {
              map.set(item.alertKey, item);
              set.add(item.alertKey);
            });
            setAckMap(map);
            setDismissedIds(set);
            try {
              localStorage.setItem(storageKey, JSON.stringify([...set]));
            } catch {
              // ignore
            }
          }
        } catch {
          // fallback to localStorage
        }
      }
    } finally {
      setLoading(false);
    }
  }, [actor, branchId, ctx.firmId, storageKey]);

  useEffect(() => {
    void loadAlertsData();
  }, [loadAlertsData, refreshKey]);

  /* Build synthesized alerts list from live data */
  const allAlerts = useMemo(() => {
    const list: OperationAlert[] = [];

    // 1. Critical stock alerts
    criticalStock.forEach((item) => {
      list.push({
        id: `stock-${item.id}`,
        severity: "critical",
        category: "inventory",
        title: `Kritik Stok: ${item.name}`,
        message: `Mevcut miktar kritik seviyenin altında (${item.onHand} ${item.unit}). Güvenlik eşiği: ${item.criticalBelow} ${item.unit}.`,
        detail: `Eksik: −${item.belowThresholdBy} ${item.unit}. Tükenme riskine karşı mal kabul veya sipariş girişi önerilir.`,
        timestamp: "Anlık Durum",
        timeAgo: "Aktif",
        actionText: "Mal Kabul / Stok Girişi",
        actionLink: "/admin/inventory/receiving",
      });
    });

    // 2. Tables with long service / open checks
    const occupiedTables = tables.filter((t) => t.assignment);
    occupiedTables.forEach((table) => {
      if (!table.assignment) return;
      const openedAt = table.assignment.openedAt;
      const timeAgo = openedAt ? calcMinutesAgo(openedAt) : "Aktif";
      const totalStr = money(table.assignment.totalMinor);

      list.push({
        id: `table-${table.id}`,
        severity: "warning",
        category: "tables",
        title: `${table.name} Serviste Bekliyor`,
        message: `${table.assignment.waiterName || "Garson"} tarafından açılan adisyon (${totalStr}) açık durumda.`,
        detail: `${timeAgo} açıldı. Masanın adisyonu henüz kapatılmadı.`,
        timestamp: openedAt || "",
        timeAgo,
        actionText: "Masa Planını Aç",
        actionLink: "/admin/branches/tables",
      });
    });

    // 3. Cash shifts
    if (cashData && cashData.openShifts && cashData.openShifts.length > 0) {
      cashData.openShifts.forEach((os, idx) => {
        const expected =
          os.shift.expectedCashMinor ??
          os.shift.openingCashMinor + os.cashInMinor - os.cashOutMinor;
        list.push({
          id: `cash-shift-${idx}`,
          severity: "info",
          category: "cash",
          title: "Açık Kasa Vardiyası",
          message: `Kasada aktif açık vardiya bulunuyor. Sistem teorik nakdi: ${money(expected)}.`,
          detail: `Toplam nakit çıkışı: ${money(os.cashOutMinor)}. Gün sonu kasa sayımı öncesi kontrolleri yapabilirsiniz.`,
          timestamp: os.shift.openedAt,
          timeAgo: calcMinutesAgo(os.shift.openedAt),
          actionText: "Kasa Özeti",
          actionLink: "/admin/cash/summary",
        });
      });
    } else {
      list.push({
        id: "cash-no-shift",
        severity: "warning",
        category: "cash",
        title: "Açık Vardiya Bulunmuyor",
        message: "Şu anda şubede açık bir kasa vardiyası görünmüyor.",
        detail: "Nakit satış ve kasa işlemleri için yeni vardiya açılışı yapılması tavsiye edilir.",
        timestamp: "Şu anda",
        timeAgo: "Güncel",
        actionText: "Vardiya Açılışı Yap",
        actionLink: "/admin/cash/opening-closing",
      });
    }

    // 4. Kitchen / KDS task alerts
    if (kitchenTasks.length > 0) {
      list.push({
        id: "kitchen-waiting",
        severity: kitchenTasks.length > 5 ? "critical" : "warning",
        category: "kitchen",
        title: `Mutfak Sırasında ${kitchenTasks.length} Sipariş Kalemi Var`,
        message: "KDS ekranında hazırlık aşamasında bekleyen siparişler bulunuyor.",
        detail: `Son sipariş: ${kitchenTasks[0]?.productName || "Ürün"}. Hazırlık süresini hızlandırmak için mutfak panelini inceleyin.`,
        timestamp: kitchenTasks[0]?.submittedAt || "",
        timeAgo: kitchenTasks[0] ? calcMinutesAgo(kitchenTasks[0].submittedAt) : "Aktif",
        actionText: "KDS Ekranını Aç",
        actionLink: "/kitchen",
        isExternalLink: true,
      });
    } else {
      list.push({
        id: "kitchen-all-clear",
        severity: "info",
        category: "kitchen",
        title: "Mutfak Sırası Temiz",
        message: "Şu anda mutfak ekranında bekleyen veya geciken sipariş bulunmuyor.",
        detail: "Tüm sipariş kalemleri mutfak personeli tarafından hazırlandı.",
        timestamp: "Şu anda",
        timeAgo: "Güncel",
        actionText: "KDS Ekranı",
        actionLink: "/kitchen",
        isExternalLink: true,
      });
    }

    return list;
  }, [cashData, criticalStock, kitchenTasks, tables]);

  // Split into active vs archived
  const activeAlerts = useMemo(() => {
    return allAlerts.filter((a) => !dismissedIds.has(a.id));
  }, [allAlerts, dismissedIds]);

  const archivedAlerts = useMemo(() => {
    return allAlerts.filter((a) => dismissedIds.has(a.id));
  }, [allAlerts, dismissedIds]);

  /* Filter alerts based on active tab, severity, category, search */
  const displayedAlerts = useMemo(() => {
    const baseList = activeTab === "active" ? activeAlerts : archivedAlerts;

    return baseList.filter((alert) => {
      if (severityFilter !== "all" && alert.severity !== severityFilter) return false;
      if (categoryFilter !== "all" && alert.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = alert.title.toLowerCase().includes(q);
        const matchMsg = alert.message.toLowerCase().includes(q);
        const matchDetail = alert.detail?.toLowerCase().includes(q);
        if (!matchTitle && !matchMsg && !matchDetail) return false;
      }
      return true;
    });
  }, [activeAlerts, activeTab, archivedAlerts, categoryFilter, searchQuery, severityFilter]);

  // Counters
  const criticalActiveCount = activeAlerts.filter((a) => a.severity === "critical").length;
  const warningActiveCount = activeAlerts.filter((a) => a.severity === "warning").length;
  const infoActiveCount = activeAlerts.filter((a) => a.severity === "info").length;
  const archivedCount = archivedAlerts.length;

  const toggleDismiss = (id: string) => {
    const alert = allAlerts.find((a) => a.id === id);
    const next = new Set(dismissedIds);
    const isCurrentlyDismissed = next.has(id);
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    const headers = { "Content-Type": "application/json", "X-Demo-Actor": actor };

    if (isCurrentlyDismissed) {
      next.delete(id);
      saveDismissed(next);
      setAckMap((prev) => {
        const m = new Map(prev);
        m.delete(id);
        return m;
      });
      if (branchId) {
        void fetch(
          `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/alerts/reset`,
          { method: "POST", headers, body: JSON.stringify({ alertKey: id }) }
        );
      }
    } else {
      next.add(id);
      saveDismissed(next);
      if (alert) {
        const newRec: AcknowledgedAlertRecord = {
          alertKey: id,
          category: alert.category,
          title: alert.title,
          actor,
          acknowledgedAt: new Date().toISOString(),
        };
        setAckMap((prev) => new Map(prev).set(id, newRec));
        if (branchId) {
          void fetch(
            `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/alerts/acknowledge`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                alertKey: id,
                category: alert.category,
                title: alert.title,
              }),
            }
          );
        }
      }
    }
  };

  const dismissAll = () => {
    const next = new Set(dismissedIds);
    activeAlerts.forEach((a) => next.add(a.id));
    saveDismissed(next);
    const newMap = new Map(ackMap);
    activeAlerts.forEach((a) => {
      newMap.set(a.id, {
        alertKey: a.id,
        category: a.category,
        title: a.title,
        actor,
        acknowledgedAt: new Date().toISOString(),
      });
    });
    setAckMap(newMap);
    if (branchId && activeAlerts.length > 0) {
      const base = import.meta.env.VITE_API_BASE_URL ?? "";
      const headers = { "Content-Type": "application/json", "X-Demo-Actor": actor };
      void fetch(
        `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/alerts/acknowledge`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            items: activeAlerts.map((a) => ({
              alertKey: a.id,
              category: a.category,
              title: a.title,
            })),
          }),
        }
      );
    }
  };

  const resetDismissed = () => {
    saveDismissed(new Set());
    setAckMap(new Map());
    if (branchId) {
      const base = import.meta.env.VITE_API_BASE_URL ?? "";
      const headers = { "Content-Type": "application/json", "X-Demo-Actor": actor };
      void fetch(
        `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/alerts/reset`,
        { method: "POST", headers, body: JSON.stringify({ all: true }) }
      );
    }
  };

  const getCategoryIcon = (category: AlertCategory) => {
    switch (category) {
      case "inventory":
        return <Boxes size={18} />;
      case "tables":
        return <LayoutGrid size={18} />;
      case "cash":
        return <Wallet size={18} />;
      case "kitchen":
        return <ChefHat size={18} />;
      default:
        return <AlertCircle size={18} />;
    }
  };

  const getCategoryLabel = (category: AlertCategory) => {
    switch (category) {
      case "inventory":
        return "Stok & Hammadde";
      case "tables":
        return "Masa & Servis";
      case "cash":
        return "Kasa & Vardiya";
      case "kitchen":
        return "Mutfak & KDS";
      default:
        return "Genel";
    }
  };

  return (
    <main className="alerts-page">
      {/* ━━━━ ÜST BAŞLIK VE GERİ BUTONU ━━━━ */}
      <div className="alerts-header-row">
        <Link to="/admin" className="alerts-back-link">
          <ArrowLeft size={16} />
          <span>Genel Bakışa Dön</span>
        </Link>
        <div className="alerts-header-actions">
          <button
            type="button"
            className="soft-button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            title="Uyarı verilerini yenile"
          >
            <RefreshCw size={14} className={loading ? "is-spinning" : ""} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      <PageHeading
        eyebrow="İŞLETME DİKKAT MERKEZİ"
        title="Canlı Operasyon Uyarıları"
        description={`${ctx.selectedBranch?.name ?? ctx.firm} · İncelendiğiniz uyarılar anında arşivlenir ve sayfa yenilense de kalıcı olarak saklanır.`}
        action={
          <StatusPill tone={criticalActiveCount > 0 ? "orange" : "green"}>
            {criticalActiveCount > 0
              ? `${criticalActiveCount} Aktif Kritik Uyarı`
              : "Sistem Normal"}
          </StatusPill>
        }
      />

      {/* ━━━━ KPI ÖZET ŞERİDİ (4 KART) ━━━━ */}
      <section className="alerts-kpi-grid" aria-label="Uyarı istatistikleri">
        <div
          className={`alerts-kpi-card critical ${severityFilter === "critical" ? "is-active" : ""}`}
          onClick={() => {
            setActiveTab("active");
            setSeverityFilter(severityFilter === "critical" ? "all" : "critical");
          }}
          title="Kritik uyarıları filtrele"
        >
          <div className="alerts-kpi-icon red">
            <ShieldAlert size={22} />
          </div>
          <div className="alerts-kpi-info">
            <span className="alerts-kpi-label">KRİTİK UYARILAR</span>
            <strong>{criticalActiveCount}</strong>
            <small>Acil müdahale gerektiren</small>
          </div>
        </div>

        <div
          className={`alerts-kpi-card warning ${severityFilter === "warning" ? "is-active" : ""}`}
          onClick={() => {
            setActiveTab("active");
            setSeverityFilter(severityFilter === "warning" ? "all" : "warning");
          }}
          title="Bekleyen işlemleri filtrele"
        >
          <div className="alerts-kpi-icon amber">
            <AlertTriangle size={22} />
          </div>
          <div className="alerts-kpi-info">
            <span className="alerts-kpi-label">DİKKAT / BEKLEYEN</span>
            <strong>{warningActiveCount}</strong>
            <small>Takip gerektiren işlemler</small>
          </div>
        </div>

        <div
          className={`alerts-kpi-card info ${severityFilter === "info" ? "is-active" : ""}`}
          onClick={() => {
            setActiveTab("active");
            setSeverityFilter(severityFilter === "info" ? "all" : "info");
          }}
          title="Operasyon durumlarını filtrele"
        >
          <div className="alerts-kpi-icon blue">
            <Info size={22} />
          </div>
          <div className="alerts-kpi-info">
            <span className="alerts-kpi-label">BİLGİ / DURUM</span>
            <strong>{infoActiveCount}</strong>
            <small>Operasyonel bildirimler</small>
          </div>
        </div>

        <div
          className={`alerts-kpi-card total ${activeTab === "archived" ? "is-active" : ""}`}
          onClick={() => {
            setActiveTab(activeTab === "archived" ? "active" : "archived");
            setSeverityFilter("all");
          }}
          title="İncelenenler Arşivine geçiş yap"
        >
          <div className="alerts-kpi-icon neutral">
            <Archive size={22} />
          </div>
          <div className="alerts-kpi-info">
            <span className="alerts-kpi-label">İNCELENEN ARŞİV</span>
            <strong>{archivedCount}</strong>
            <small>{activeTab === "archived" ? "Şu an görüntüleniyor" : "Görüntülemek için dokunun"}</small>
          </div>
        </div>
      </section>

      {/* ━━━━ FİLTRE VE ARAMA KONTROL PANELİ ━━━━ */}
      <section className="card content-card alerts-control-panel">
        {/* Üst Sekmeler: Aktif Uyarılar vs İncelenenler Arşivi */}
        <div className="alerts-tab-switch-row">
          <div className="alerts-tab-group">
            <button
              type="button"
              className={`alerts-main-tab ${activeTab === "active" ? "active" : ""}`}
              onClick={() => setActiveTab("active")}
            >
              <span>Aktif Uyarılar</span>
              <span className="alerts-tab-badge">{activeAlerts.length}</span>
            </button>
            <button
              type="button"
              className={`alerts-main-tab ${activeTab === "archived" ? "active" : ""}`}
              onClick={() => setActiveTab("archived")}
            >
              <Archive size={14} />
              <span>İncelenenler Arşivi</span>
              {archivedCount > 0 && (
                <span className="alerts-tab-badge archived">{archivedCount}</span>
              )}
            </button>
          </div>

          <div className="alerts-batch-buttons">
            {activeTab === "active" ? (
              <button
                type="button"
                className="soft-button alerts-action-btn"
                onClick={dismissAll}
                disabled={activeAlerts.length === 0}
                title="Ekrandaki tüm aktif uyarıları incelendi olarak arşivle"
              >
                <Check size={14} />
                <span>Tümünü İncelendi Yap ({activeAlerts.length})</span>
              </button>
            ) : (
              <button
                type="button"
                className="soft-button alerts-action-btn"
                onClick={resetDismissed}
                disabled={archivedCount === 0}
                title="İncelenen tüm uyarıları tekrar aktif listeye geri al"
              >
                <RotateCcw size={14} />
                <span>Arşivi Sıfırla (Tümünü Geri Al)</span>
              </button>
            )}
          </div>
        </div>

        <div className="alerts-controls-row">
          {/* Arama Kutusu */}
          <div className="alerts-search-box">
            <Search size={16} className="alerts-search-icon" />
            <input
              type="text"
              placeholder="Uyarı başlığı veya içerik ara…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="alerts-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="alerts-search-clear"
                onClick={() => setSearchQuery("")}
              >
                ✕
              </button>
            )}
          </div>

          {/* Kategori Seçici */}
          <div className="alerts-category-selector">
            <span className="alerts-filter-title">
              <Filter size={14} /> Kategori:
            </span>
            <div className="alerts-chips-row">
              <button
                type="button"
                className={`alerts-chip ${categoryFilter === "all" ? "active" : ""}`}
                onClick={() => setCategoryFilter("all")}
              >
                Tümü
              </button>
              <button
                type="button"
                className={`alerts-chip ${categoryFilter === "inventory" ? "active" : ""}`}
                onClick={() => setCategoryFilter("inventory")}
              >
                <Boxes size={13} /> Stok & Mal Kabul
              </button>
              <button
                type="button"
                className={`alerts-chip ${categoryFilter === "tables" ? "active" : ""}`}
                onClick={() => setCategoryFilter("tables")}
              >
                <LayoutGrid size={13} /> Masa & Servis
              </button>
              <button
                type="button"
                className={`alerts-chip ${categoryFilter === "kitchen" ? "active" : ""}`}
                onClick={() => setCategoryFilter("kitchen")}
              >
                <ChefHat size={13} /> Mutfak & KDS
              </button>
              <button
                type="button"
                className={`alerts-chip ${categoryFilter === "cash" ? "active" : ""}`}
                onClick={() => setCategoryFilter("cash")}
              >
                <Wallet size={13} /> Kasa & Vardiya
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━━ UYARI KARTLARI LİSTESİ ━━━━ */}
      <section className="alerts-list-section" aria-label="Uyarı listesi">
        {loading ? (
          <div className="card alerts-empty-card">
            <RefreshCw size={24} className="is-spinning" />
            <p>İşletme uyarıları taranıyor…</p>
          </div>
        ) : displayedAlerts.length === 0 ? (
          <div className="card alerts-empty-card">
            <CheckCircle2 size={36} className="alerts-empty-icon" />
            <h3>
              {activeTab === "active"
                ? "Tebrikler! Bekleyen aktif uyarı bulunmuyor."
                : "Arşivde incelenmiş uyarı bulunmuyor."}
            </h3>
            <p>
              {searchQuery || severityFilter !== "all" || categoryFilter !== "all"
                ? "Filtreleri temizleyerek diğer uyarıları görebilirsiniz."
                : activeTab === "active"
                  ? "Tüm uyarılar incelendi veya şubenizde şu anda müdahale bekleyen bir sorun yok."
                  : "İncelendi olarak işaretlediğiniz bildirimler bu sekmede saklanır."}
            </p>
            {activeTab === "active" && archivedCount > 0 && (
              <button
                type="button"
                className="soft-button"
                onClick={() => setActiveTab("archived")}
              >
                <Archive size={14} /> İncelenenler Arşivini İncele ({archivedCount})
              </button>
            )}
          </div>
        ) : (
          <div className="alerts-cards-container">
            {displayedAlerts.map((alert) => {
              const isDismissed = dismissedIds.has(alert.id);

              return (
                <article
                  key={alert.id}
                  className={`card alerts-card severity-${alert.severity} ${isDismissed ? "is-dismissed" : ""}`}
                >
                  {/* Sol Renkli Çizgi ve Kategori İkonu */}
                  <div className="alerts-card-sidebar">
                    <span
                      className={`alerts-severity-icon-badge ${alert.severity}`}
                      title={alert.severity.toUpperCase()}
                    >
                      {alert.severity === "critical" ? (
                        <ShieldAlert size={18} />
                      ) : alert.severity === "warning" ? (
                        <AlertTriangle size={18} />
                      ) : (
                        <Info size={18} />
                      )}
                    </span>
                  </div>

                  {/* Orta İçerik */}
                  <div className="alerts-card-content">
                    <div className="alerts-card-meta">
                      <span className="alerts-category-tag">
                        {getCategoryIcon(alert.category)}
                        <span>{getCategoryLabel(alert.category)}</span>
                      </span>

                      <span className={`alerts-severity-pill ${alert.severity}`}>
                        {alert.severity === "critical"
                          ? "Kritik Eşik"
                          : alert.severity === "warning"
                            ? "Bekleyen İşlem"
                            : "Operasyon Durumu"}
                      </span>

                      <span className="alerts-time-tag">
                        <Clock size={12} />
                        <span>{alert.timeAgo}</span>
                      </span>

                      {isDismissed && (
                        <span
                          className="alerts-dismissed-tag"
                          title={
                            ackMap.get(alert.id)?.acknowledgedAt
                              ? `İnceleyen: ${ackMap.get(alert.id)?.actor} · ${new Date(ackMap.get(alert.id)!.acknowledgedAt).toLocaleString("tr-TR")}`
                              : undefined
                          }
                        >
                          <Check size={12} /> İncelendi {ackMap.get(alert.id)?.actor ? `(${ackMap.get(alert.id)?.actor})` : "(Arşivde)"}
                        </span>
                      )}
                    </div>

                    <h3 className="alerts-card-title">{alert.title}</h3>
                    <p className="alerts-card-message">{alert.message}</p>
                    {alert.detail && (
                      <p className="alerts-card-detail">{alert.detail}</p>
                    )}
                  </div>

                  {/* Sağ Aksiyonlar */}
                  <div className="alerts-card-actions">
                    {alert.isExternalLink ? (
                      <a
                        href={alert.actionLink}
                        target="_blank"
                        rel="noreferrer"
                        className="alerts-primary-action"
                      >
                        <span>{alert.actionText}</span>
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <Link
                        to={alert.actionLink}
                        className="alerts-primary-action"
                      >
                        <span>{alert.actionText}</span>
                        <ArrowRight size={14} />
                      </Link>
                    )}

                    <button
                      type="button"
                      className={`alerts-dismiss-btn ${isDismissed ? "active" : ""}`}
                      onClick={() => toggleDismiss(alert.id)}
                      title={
                        isDismissed
                          ? "Uyarıyı aktif listeye geri al"
                          : "Uyarıyı incelendi olarak arşivle (ekrandan kaldır)"
                      }
                    >
                      {isDismissed ? (
                        <>
                          <RotateCcw size={13} />
                          <span>Geri Al</span>
                        </>
                      ) : (
                        <>
                          <Check size={13} />
                          <span>İncelendi</span>
                        </>
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
