import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Filter,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { adminFetch } from "../../shared/authFetch";
import type { ViewContext } from "../../app/context";
import { PageHeading, StatusPill } from "../../shared/ui";

type SalesOrderItem = {
  productName: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

type SalesOrder = {
  id: string;
  status: string;
  source: string;
  createdAt: string;
  totalMinor: number;
  items: SalesOrderItem[];
};

type SalesSummaryResponse = { items: SalesOrder[] };

type DayStatEntry = {
  total: number;
  count: number;
  orders: SalesOrder[];
};

type DaySummary = {
  dayNumber: number;
  dateKey: string;
  fullDateLabel: string;
  total: number;
  count: number;
  orders: SalesOrder[];
  averageCheck: number;
};

/* ── Formatters ── */
const money = (minor: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(minor / 100);

const istanbulDay = (date: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const turkishMonthYear = (dateStr: string) => {
  if (!dateStr) return "";
  const [year, month] = dateStr.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
  }).format(date);
};

const turkishFullDate = (dateStr: string) => {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  }).format(date);
};

const getDaysInMonth = (year: number, month: number) => {
  // month is 1-based (1..12)
  return new Date(year, month, 0).getDate();
};

export function MonthlyDailyTurnoverPage({ ctx }: { ctx: ViewContext }) {
  const branchId = ctx.selectedBranch?.apiId ?? null;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [onlyActiveDays, setOnlyActiveDays] = useState(false);
  const [selectedDayDetail, setSelectedDayDetail] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const scope = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      const path = `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/sales/orders${scope}`;
      const response = await adminFetch(path, { firmId: ctx.firmId, demoActor: actor });
      if (!response.ok) throw new Error(`API hatası (${response.status})`);
      const data = (await response.json()) as SalesSummaryResponse;
      setOrders(data.items ?? []);
    } catch (err) {
      setError((err as Error).message ?? "Sipariş verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [actor, branchId, ctx.firmId]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders, refreshKey]);

  /* Group Orders by Month and Day, and populate all 12 months for every active year */
  const { availableMonths, dailyStatsByMonth } = useMemo(() => {
    const monthsSet = new Set<string>();
    const monthDayMap = new Map<string, Map<string, DayStatEntry>>();

    const currentYear = new Date().getFullYear();
    const yearsSet = new Set<number>([currentYear - 1, currentYear]);

    orders.forEach((order) => {
      const date = new Date(order.createdAt);
      yearsSet.add(date.getFullYear());
      const dayKey = istanbulDay(date); // YYYY-MM-DD
      const monthKey = dayKey.substring(0, 7); // YYYY-MM

      monthsSet.add(monthKey);

      if (!monthDayMap.has(monthKey)) {
        monthDayMap.set(monthKey, new Map());
      }
      const dayMap = monthDayMap.get(monthKey)!;
      const cur = dayMap.get(dayKey) ?? { total: 0, count: 0, orders: [] };
      cur.total += order.totalMinor;
      cur.count += 1;
      cur.orders.push(order);
      dayMap.set(dayKey, cur);
    });

    // Populate all 12 months for every year found so the user can freely select ANY month
    yearsSet.forEach((yr) => {
      for (let m = 1; m <= 12; m++) {
        const mKey = `${yr}-${String(m).padStart(2, "0")}`;
        monthsSet.add(mKey);
        if (!monthDayMap.has(mKey)) {
          monthDayMap.set(mKey, new Map());
        }
      }
    });

    const sortedMonths = [...monthsSet].sort().reverse();
    return { availableMonths: sortedMonths, dailyStatsByMonth: monthDayMap };
  }, [orders]);

  // Default selected month: prefer latest month that has active orders, or current month
  useEffect(() => {
    if (!selectedMonth && availableMonths.length > 0) {
      const currentMonthKey = istanbulDay(new Date()).substring(0, 7);
      const monthWithOrders = availableMonths.find(
        (m) => (dailyStatsByMonth.get(m)?.size ?? 0) > 0
      );
      setSelectedMonth(monthWithOrders ?? currentMonthKey);
    }
  }, [availableMonths, dailyStatsByMonth, selectedMonth]);

  // Step between months via buttons
  const changeMonthBy = useCallback(
    (delta: number) => {
      if (!selectedMonth) return;
      const [y, m] = selectedMonth.split("-").map(Number);
      const date = new Date(y, m - 1 + delta, 1);
      const newMonthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      setSelectedMonth(newMonthKey);
      setSelectedDayDetail(null);
    },
    [selectedMonth]
  );

  /* Build all days of the selected month (1..28/30/31) */
  const activeMonthData = useMemo(() => {
    if (!selectedMonth) return null;
    const [yStr, mStr] = selectedMonth.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    const daysInMonth = getDaysInMonth(year, month);

    const dayMap =
      dailyStatsByMonth.get(selectedMonth) ?? new Map<string, DayStatEntry>();

    const allDays: DaySummary[] = [];
    let monthTotal = 0;
    let monthOrdersCount = 0;
    let maxDayTurnover = 0;
    let bestDay = { key: "", total: 0, label: "" };

    for (let d = 1; d <= daysInMonth; d++) {
      const dayFormatted = String(d).padStart(2, "0");
      const dayKey = `${selectedMonth}-${dayFormatted}`;
      const stat = dayMap.get(dayKey) ?? { total: 0, count: 0, orders: [] };

      monthTotal += stat.total;
      monthOrdersCount += stat.count;
      if (stat.total > maxDayTurnover) {
        maxDayTurnover = stat.total;
        bestDay = {
          key: dayKey,
          total: stat.total,
          label: `${d} ${new Intl.DateTimeFormat("tr-TR", { month: "short" }).format(new Date(year, month - 1, d))}`,
        };
      }

      allDays.push({
        dayNumber: d,
        dateKey: dayKey,
        fullDateLabel: turkishFullDate(dayKey),
        total: stat.total,
        count: stat.count,
        orders: stat.orders,
        averageCheck: stat.count > 0 ? Math.round(stat.total / stat.count) : 0,
      });
    }

    const activeDaysCount = allDays.filter((d) => d.count > 0).length;
    const averageDaily =
      activeDaysCount > 0 ? Math.round(monthTotal / activeDaysCount) : 0;

    return {
      monthKey: selectedMonth,
      monthLabel: turkishMonthYear(selectedMonth),
      monthTotal,
      monthOrdersCount,
      activeDaysCount,
      averageDaily,
      maxDayTurnover: Math.max(1, maxDayTurnover),
      bestDay,
      days: allDays,
    };
  }, [dailyStatsByMonth, selectedMonth]);

  const displayedDays = useMemo(() => {
    if (!activeMonthData) return [];
    if (onlyActiveDays) {
      return activeMonthData.days.filter((d) => d.count > 0);
    }
    return activeMonthData.days;
  }, [activeMonthData, onlyActiveDays]);

  const selectedDayOrders = useMemo(() => {
    if (!selectedDayDetail || !activeMonthData) return null;
    return activeMonthData.days.find((d) => d.dateKey === selectedDayDetail);
  }, [activeMonthData, selectedDayDetail]);

  return (
    <main className="turnover-analysis-page">
      {/* ━━━━ HEADER: Geri Dönüş ve Yenile Butonu ━━━━ */}
      <div className="turnover-header-row">
        <Link to="/admin" className="turnover-back-link">
          <ArrowLeft size={16} />
          <span>Genel Bakışa Dön</span>
        </Link>
        <div className="turnover-actions">
          <button
            type="button"
            className="soft-button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            title="Sipariş verilerini yenile"
          >
            <RefreshCw size={14} className={loading ? "is-spinning" : ""} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      <PageHeading
        eyebrow="GÜNLÜK VE AYLIK CİRO ANALİZİ"
        title="Her Ayın ve Her Günün Cirosu"
        description={`${ctx.selectedBranch?.name ?? ctx.firm} · İstediğiniz ayı açılır menüden seçin; tüm günlerin cirosunu, sipariş adedini ve sepet ortalamasını inceleyin.`}
        action={<StatusPill tone="green">Canlı Veri</StatusPill>}
      />

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      {/* ━━━━ AY SEÇİCİ DROPDOWN VE HIZLI GEÇİŞ ÇUBUĞU ━━━━ */}
      <div className="turnover-month-selector-bar">
        <div className="turnover-month-dropdown-group">
          <label
            htmlFor="turnover-month-select"
            className="turnover-select-label"
          >
            <Calendar size={18} />
            <span>İncelenen Ay:</span>
          </label>
          <div className="turnover-select-wrapper">
            <select
              id="turnover-month-select"
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setSelectedDayDetail(null);
              }}
              className="turnover-month-dropdown"
              aria-label="Cirosunu görmek istediğiniz ayı seçin"
            >
              {availableMonths.map((mKey) => {
                const stats = dailyStatsByMonth.get(mKey);
                const count = stats?.size ?? 0;
                let totalMinor = 0;
                if (stats) {
                  for (const s of stats.values()) totalMinor += s.total;
                }
                const label = turkishMonthYear(mKey);
                const suffix =
                  count > 0
                    ? ` — ${count} işlem günü (${money(totalMinor)})`
                    : " — Kayıt yok";
                return (
                  <option key={mKey} value={mKey}>
                    {label} {suffix}
                  </option>
                );
              })}
            </select>
            <ChevronDown size={18} className="turnover-dropdown-icon" />
          </div>
        </div>

        {/* Önceki / Sonraki Ay Hızlı Adımlama Butonları */}
        <div className="turnover-month-stepper">
          <button
            type="button"
            className="turnover-step-button"
            onClick={() => changeMonthBy(-1)}
            title="Bir önceki ayı görüntüle"
          >
            <ChevronLeft size={16} />
            <span>Önceki Ay</span>
          </button>
          <span className="turnover-current-badge">
            {turkishMonthYear(selectedMonth)}
          </span>
          <button
            type="button"
            className="turnover-step-button"
            onClick={() => changeMonthBy(1)}
            title="Bir sonraki ayı görüntüle"
          >
            <span>Sonraki Ay</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {activeMonthData && (
        <>
          {/* ━━━━ AY ÖZETİ KPI KARTLARI (MOBİLDE 2x2 VEYA TEK SÜTUN) ━━━━ */}
          <section
            className="overview-kpi-strip turnover-kpi-grid"
            aria-label={`${activeMonthData.monthLabel} ay özeti`}
          >
            <div className="overview-kpi-card">
              <div className="overview-kpi-icon green">
                <TrendingUp size={22} />
              </div>
              <div className="overview-kpi-body">
                <span className="overview-kpi-label">AYLIK TOPLAM CİRO</span>
                <strong>{money(activeMonthData.monthTotal)}</strong>
                <small>{activeMonthData.monthLabel} Toplamı</small>
              </div>
            </div>

            <div className="overview-kpi-card">
              <div className="overview-kpi-icon blue">
                <ShoppingBag size={22} />
              </div>
              <div className="overview-kpi-body">
                <span className="overview-kpi-label">TOPLAM SİPARİŞ</span>
                <strong>{activeMonthData.monthOrdersCount}</strong>
                <small>
                  {activeMonthData.activeDaysCount} aktif işlem gününde
                </small>
              </div>
            </div>

            <div className="overview-kpi-card">
              <div className="overview-kpi-icon purple">
                <CreditCard size={22} />
              </div>
              <div className="overview-kpi-body">
                <span className="overview-kpi-label">GÜNLÜK ORTALAMA</span>
                <strong>{money(activeMonthData.averageDaily)}</strong>
                <small>İşlem günleri ortalaması</small>
              </div>
            </div>

            <div className="overview-kpi-card">
              <div className="overview-kpi-icon orange">
                <Sparkles size={22} />
              </div>
              <div className="overview-kpi-body">
                <span className="overview-kpi-label">EN YÜKSEK GÜN</span>
                <strong>
                  {activeMonthData.bestDay.total > 0
                    ? money(activeMonthData.bestDay.total)
                    : "—"}
                </strong>
                <small>
                  {activeMonthData.bestDay.label || "Kayıt bulunamadı"}
                </small>
              </div>
            </div>
          </section>

          {/* ━━━━ GÜNLÜK TABLO VE GÖRSEL BAR DÖKÜMÜ ━━━━ */}
          <section className="card content-card turnover-table-card">
            <div className="card-heading padded turnover-card-heading">
              <div>
                <span className="card-kicker">GÜN GÜN CİRO DÖKÜMÜ</span>
                <h2>{activeMonthData.monthLabel} Günlük Kayıtlar</h2>
              </div>
              <div className="turnover-filter-controls">
                <button
                  type="button"
                  className={`soft-button turnover-toggle-filter ${onlyActiveDays ? "active" : ""}`}
                  onClick={() => setOnlyActiveDays((cur) => !cur)}
                >
                  <Filter size={14} />
                  <span>
                    {onlyActiveDays
                      ? "Tüm Günleri Göster (1–31)"
                      : "Sadece İşlem Olan Günler"}
                  </span>
                </button>
              </div>
            </div>

            <div className="turnover-days-container">
              {/* Masaüstü Başlık Satırı */}
              <div className="turnover-table-header" aria-hidden="true">
                <span className="col-day">GÜN / TARİH</span>
                <span className="col-turnover">CİRO (TL)</span>
                <span className="col-orders">SİPARİŞ</span>
                <span className="col-avg">ORT. FİŞ</span>
                <span className="col-ratio">AYLIK ORAN</span>
                <span className="col-status">DURUM</span>
              </div>

              <div className="turnover-days-list">
                {displayedDays.map((day) => {
                  const percent =
                    activeMonthData.maxDayTurnover > 0 && day.total > 0
                      ? Math.round(
                          (day.total / activeMonthData.maxDayTurnover) * 100
                        )
                      : 0;
                  const isBest =
                    day.total > 0 &&
                    day.total === activeMonthData.maxDayTurnover;

                  return (
                    <div
                      key={day.dateKey}
                      className={`turnover-day-row ${day.count > 0 ? "has-data" : "no-data"} ${isBest ? "is-best" : ""}`}
                      onClick={() =>
                        day.count > 0 && setSelectedDayDetail(day.dateKey)
                      }
                      title={
                        day.count > 0
                          ? "Sipariş detaylarını incelemek için dokunun"
                          : undefined
                      }
                    >
                      <div className="col-day">
                        <strong>{day.dayNumber}. Gün</strong>
                        <small>{day.fullDateLabel}</small>
                      </div>

                      {/* Metrikler Grubu: Masaüstünde serbest grid, mobilde kompakt şerit */}
                      <div className="turnover-metrics-group">
                        <div className="col-turnover">
                          <small className="mobile-metric-label">Ciro</small>
                          <strong>
                            {day.total > 0 ? money(day.total) : "—"}
                          </strong>
                        </div>

                        <div className="col-orders">
                          <small className="mobile-metric-label">Sipariş</small>
                          <span>
                            {day.count > 0 ? `${day.count} adet` : "0"}
                          </span>
                        </div>

                        <div className="col-avg">
                          <small className="mobile-metric-label">Ort. Fiş</small>
                          <span>
                            {day.averageCheck > 0
                              ? money(day.averageCheck)
                              : "—"}
                          </span>
                        </div>
                      </div>

                      <div className="col-ratio">
                        <div className="turnover-ratio-bar">
                          <span
                            style={{ width: `${percent}%` }}
                            className={isBest ? "best-bar" : ""}
                          />
                        </div>
                        <small>{percent > 0 ? `%${percent}` : "0"}</small>
                      </div>

                      <div className="col-status">
                        {isBest ? (
                          <span className="status-badge best">
                            ⭐ Ayın Zirvesi
                          </span>
                        ) : day.count > 0 ? (
                          <span className="status-badge active">
                            İşlem Var
                          </span>
                        ) : (
                          <span className="status-badge empty">Kayıt Yok</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ━━━━ GÜN DETAYI MODALI (MOBİL UYUMLU) ━━━━ */}
          {selectedDayOrders && (
            <div
              className="turnover-modal-backdrop"
              onClick={() => setSelectedDayDetail(null)}
            >
              <div
                className="card content-card turnover-modal-content"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="turnover-modal-header">
                  <div>
                    <span className="card-kicker">GÜN İŞLEM DETAYLARI</span>
                    <h2>{selectedDayOrders.fullDateLabel}</h2>
                    <p>
                      Toplam {selectedDayOrders.count} sipariş ·{" "}
                      <strong>{money(selectedDayOrders.total)}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-button turnover-modal-close"
                    onClick={() => setSelectedDayDetail(null)}
                    aria-label="Kapat"
                  >
                    ✕
                  </button>
                </div>

                <div className="turnover-modal-body">
                  <div className="turnover-order-detail-list">
                    {selectedDayOrders.orders.map((ord: SalesOrder, idx: number) => (
                      <div key={ord.id} className="turnover-modal-order-card">
                        <div className="order-card-header">
                          <div className="order-card-id">
                            <span>#{idx + 1}</span>
                            <strong>
                              {ord.source === "waiter_web"
                                ? "Garson Siparişi"
                                : ord.source === "test_pos"
                                  ? "Kasa Satışı"
                                  : "Açık Sipariş"}
                            </strong>
                          </div>
                          <b className="order-card-price">
                            {money(ord.totalMinor)}
                          </b>
                        </div>
                        <div className="order-card-items">
                          {ord.items.map((it: SalesOrderItem, itemIdx: number) => (
                            <div key={itemIdx} className="order-item-line">
                              <span>
                                {it.quantity}× {it.productName}
                              </span>
                              <small>{money(it.lineTotalMinor)}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="turnover-modal-footer">
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => setSelectedDayDetail(null)}
                  >
                    Kapat
                  </button>
                  <Link to="/admin/sales/open" className="primary-button">
                    Satışlar Ekranına Git
                  </Link>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
