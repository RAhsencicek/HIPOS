import {
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Coins,
  Filter,
  ReceiptText,
  RefreshCw,
  Search,
  Tag,
  User,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";

/* ── Activity Item Model ── */
export type ActivityItem = {
  id: string;
  module: "cash" | "inventory" | "sales" | "finance" | "alerts" | string;
  type: string;
  title: string;
  description: string;
  actor: string;
  severity: "info" | "success" | "warning" | "critical" | string;
  timestamp: string;
  amountMinor?: number | null;
  badgeText?: string | null;
  actionLink?: string | null;
};

type ActivityApiResponse = {
  source: string;
  branchId: string;
  count: number;
  totalFound: number;
  items: ActivityItem[];
};

/* ── Date Helpers ── */
const formatDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      weekday: "long",
      timeZone: "Europe/Istanbul",
    }).format(d);
  } catch {
    return iso;
  }
};

const formatTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Istanbul",
    }).format(d);
  } catch {
    return "";
  }
};

const formatTimeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Dün";
  return `${days} gün önce`;
};

export function ActivityPage({ ctx }: { ctx: ViewContext }) {
  const branchId = ctx.selectedBranch?.apiId ?? null;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";

  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  /* Load Activities from Backend */
  const loadActivities = useCallback(async () => {
    setLoading(true);
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    const headers = { "X-Demo-Actor": actor };

    try {
      if (branchId) {
        const catParam = selectedCategory !== "all" ? `&category=${encodeURIComponent(selectedCategory)}` : "";
        const searchParam = searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : "";
        const res = await fetch(
          `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/overview/activities?limit=100${catParam}${searchParam}`,
          { headers }
        );
        if (res.ok) {
          const data = (await res.json()) as ActivityApiResponse;
          setActivities(data.items ?? []);
        } else {
          setActivities([]);
        }
      } else {
        setActivities([]);
      }
    } catch {
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [actor, branchId, ctx.firmId, selectedCategory, searchQuery]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities, refreshKey]);

  /* Group activities by day */
  const groupedActivities = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const item of activities) {
      const dayKey = formatDate(item.timestamp);
      const existing = map.get(dayKey) ?? [];
      existing.push(item);
      map.set(dayKey, existing);
    }
    return Array.from(map.entries()).map(([day, items]) => ({ day, items }));
  }, [activities]);

  /* Module icon helper */
  const getModuleIcon = (module: string) => {
    switch (module) {
      case "cash":
        return <Wallet size={16} />;
      case "inventory":
        return <Boxes size={16} />;
      case "sales":
        return <ReceiptText size={16} />;
      case "finance":
        return <Coins size={16} />;
      case "alerts":
        return <CheckCircle2 size={16} />;
      default:
        return <Tag size={16} />;
    }
  };

  /* Module badge label */
  const getModuleLabel = (module: string) => {
    switch (module) {
      case "cash":
        return "Kasa & Nakit";
      case "inventory":
        return "Stok & Envanter";
      case "sales":
        return "Sipariş & Satış";
      case "finance":
        return "Gider";
      case "alerts":
        return "Uyarı";
      default:
        return "Sistem";
    }
  };

  // KPI counts
  const cashCount = activities.filter((a) => a.module === "cash").length;
  const inventoryCount = activities.filter((a) => a.module === "inventory").length;
  const salesCount = activities.filter((a) => a.module === "sales").length;

  return (
    <main className="activity-page" aria-label="Son İşlemler Sayfası">
      {/* ━━━━ 1. BAŞLIK & ÖZET ━━━━ */}
      <header className="activity-header">
        <div className="activity-title-group">
          <div className="activity-badge-row">
            <span className="activity-kicker">ZAMAN TÜNELİ</span>
            <span className="activity-branch-tag">
              {ctx.selectedBranch?.name ?? "Tüm Şubeler"}
            </span>
          </div>
          <h1>Son İşlemler</h1>
          <p className="activity-subtitle">
            Kasa, mal kabul, stok zayisi ve siparişler dahil işletmenizde gerçekleşen tüm operasyonel hareketlerin canlı akışı.
          </p>
        </div>

        <div className="activity-header-actions">
          <button
            type="button"
            className="soft-button activity-refresh-btn"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            title="Akışı yenile"
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            <span>Yenile</span>
          </button>
        </div>
      </header>

      {/* ━━━━ 2. KPI ÖZET KARTLARI ━━━━ */}
      <section className="activity-kpi-grid" aria-label="Aktivite İstatistikleri">
        <div className="activity-kpi-card">
          <div className="activity-kpi-icon total">
            <Tag size={20} />
          </div>
          <div className="activity-kpi-info">
            <small>Toplam Hareket</small>
            <strong>{activities.length}</strong>
          </div>
        </div>

        <div className="activity-kpi-card">
          <div className="activity-kpi-icon cash">
            <Wallet size={20} />
          </div>
          <div className="activity-kpi-info">
            <small>Kasa & Nakit</small>
            <strong>{cashCount}</strong>
          </div>
        </div>

        <div className="activity-kpi-card">
          <div className="activity-kpi-icon inventory">
            <Boxes size={20} />
          </div>
          <div className="activity-kpi-info">
            <small>Stok & Mal Kabul</small>
            <strong>{inventoryCount}</strong>
          </div>
        </div>

        <div className="activity-kpi-card">
          <div className="activity-kpi-icon sales">
            <ReceiptText size={20} />
          </div>
          <div className="activity-kpi-info">
            <small>Sipariş & Satış</small>
            <strong>{salesCount}</strong>
          </div>
        </div>
      </section>

      {/* ━━━━ 3. FİLTRELER VE ARAMA ━━━━ */}
      <section className="card activity-filters-card" aria-label="Aktivite Filtreleri">
        <div className="activity-controls-row">
          {/* Arama Kutusu */}
          <div className="activity-search-box">
            <Search size={16} className="activity-search-icon" />
            <input
              type="text"
              placeholder="İşlem, ürün veya aktör ara…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="activity-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="activity-search-clear"
                onClick={() => setSearchQuery("")}
              >
                ✕
              </button>
            )}
          </div>

          {/* Kategori Seçici */}
          <div className="activity-category-selector">
            <span className="activity-filter-title">
              <Filter size={14} /> Filtrele:
            </span>
            <div className="activity-chips-row">
              <button
                type="button"
                className={`activity-chip ${selectedCategory === "all" ? "active" : ""}`}
                onClick={() => setSelectedCategory("all")}
              >
                Tümü
              </button>
              <button
                type="button"
                className={`activity-chip ${selectedCategory === "cash" ? "active" : ""}`}
                onClick={() => setSelectedCategory("cash")}
              >
                <Wallet size={13} /> Kasa & Nakit
              </button>
              <button
                type="button"
                className={`activity-chip ${selectedCategory === "inventory" ? "active" : ""}`}
                onClick={() => setSelectedCategory("inventory")}
              >
                <Boxes size={13} /> Stok & Mal Kabul
              </button>
              <button
                type="button"
                className={`activity-chip ${selectedCategory === "sales" ? "active" : ""}`}
                onClick={() => setSelectedCategory("sales")}
              >
                <ReceiptText size={13} /> Sipariş & Satış
              </button>
              <button
                type="button"
                className={`activity-chip ${selectedCategory === "finance" ? "active" : ""}`}
                onClick={() => setSelectedCategory("finance")}
              >
                <Coins size={13} /> Giderler
              </button>
              <button
                type="button"
                className={`activity-chip ${selectedCategory === "alerts" ? "active" : ""}`}
                onClick={() => setSelectedCategory("alerts")}
              >
                <CheckCircle2 size={13} /> Uyarı Onayları
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━━ 4. AKTİVİTE ZAMAN TÜNELİ ━━━━ */}
      <section className="activity-timeline-section" aria-label="Aktivite Zaman Çizelgesi">
        {loading ? (
          <div className="card activity-loading-card">
            <RefreshCw size={24} className="spin activity-spinner" />
            <p>Son işlemler veritabanından getiriliyor…</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="card activity-empty-card">
            <Clock size={36} className="activity-empty-icon" />
            <h3>Kayıt Bulunamadı</h3>
            <p>
              {searchQuery || selectedCategory !== "all"
                ? "Seçilen filtre ve arama kriterlerine uygun operasyonel hareket bulunamadı."
                : "Bu şube için henüz kaydedilmiş bir işlem bulunmuyor."}
            </p>
            {(searchQuery || selectedCategory !== "all") && (
              <button
                type="button"
                className="soft-button"
                onClick={() => {
                  setSelectedCategory("all");
                  setSearchQuery("");
                }}
              >
                Filtreleri Temizle
              </button>
            )}
          </div>
        ) : (
          <div className="activity-timeline-container">
            {groupedActivities.map(({ day, items }) => (
              <div key={day} className="activity-day-group">
                {/* Gün Başlığı */}
                <div className="activity-day-header">
                  <span className="activity-day-calendar-icon">
                    <Calendar size={14} />
                  </span>
                  <h3>{day}</h3>
                  <span className="activity-day-count">({items.length} işlem)</span>
                </div>

                {/* Günün Kartları */}
                <div className="activity-items-list">
                  {items.map((item) => {
                    return (
                      <article
                        key={item.id}
                        className={`card activity-item-card severity-${item.severity}`}
                      >
                        {/* Sol İkon */}
                        <div className={`activity-item-icon-badge ${item.module}`}>
                          {getModuleIcon(item.module)}
                        </div>

                        {/* Orta İçerik */}
                        <div className="activity-item-content">
                          <div className="activity-item-meta">
                            <span className={`activity-module-tag ${item.module}`}>
                              {getModuleLabel(item.module)}
                            </span>
                            <span className="activity-time-tag">
                              <Clock size={12} />
                              <span>
                                {formatTime(item.timestamp)} ({formatTimeAgo(item.timestamp)})
                              </span>
                            </span>
                            <span className="activity-actor-tag" title="İşlemi Yapan">
                              <User size={12} />
                              <span>{item.actor}</span>
                            </span>
                          </div>

                          <h4 className="activity-item-title">{item.title}</h4>
                          <p className="activity-item-desc">{item.description}</p>
                        </div>

                        {/* Sağ Rozet & Aksiyon */}
                        <div className="activity-item-actions">
                          {item.badgeText && (
                            <span className={`activity-amount-badge severity-${item.severity}`}>
                              {item.badgeText}
                            </span>
                          )}

                          {item.actionLink && (
                            <Link
                              to={item.actionLink}
                              className="activity-action-link"
                              title="İlgili ekrana git"
                            >
                              <span>İncele</span>
                              <ArrowRight size={13} />
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
