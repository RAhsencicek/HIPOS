import { adminFetch } from "../../shared/authFetch";
import {
  ArrowRight,
  Banknote,
  Calendar,
  ChartNoAxesCombined,
  CheckCircle2,
  Clock3,
  CreditCard,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Utensils,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { sections } from "../../data/catalog";
import { MetricCard, PageHeading, StatusPill } from "../../shared/ui";

type SalesAnalyticsSummary = {
  grossRevenueMinor: number;
  netRevenueMinor: number;
  discountMinor: number;
  cashRevenueMinor: number;
  cardRevenueMinor: number;
  completedChecksCount: number;
  averageCheckMinor: number;
  openChecksCount: number;
  openChecksBalanceMinor: number;
  totalItemsSold: number;
};

type PaymentMethodBreakdown = {
  method: string;
  label: string;
  count: number;
  amountMinor: number;
  percentage: number;
};

type ChannelBreakdown = {
  channel: string;
  label: string;
  count: number;
  amountMinor: number;
  percentage: number;
};

type TopProduct = {
  productId: string;
  productName: string;
  categoryName: string;
  quantity: number;
  totalRevenueMinor: number;
  percentage: number;
};

type HourlyTrend = {
  hour: string;
  count: number;
  revenueMinor: number;
};

type BranchSales = {
  branchId: string;
  branchName: string;
  checkCount: number;
  revenueMinor: number;
  percentage: number;
};

type SalesAnalyticsResponse = {
  source: string;
  scope: {
    firmId: string;
    branchId: string | null;
    range: string;
    from: string;
    to: string;
  };
  summary: SalesAnalyticsSummary;
  paymentBreakdown: PaymentMethodBreakdown[];
  channelBreakdown: ChannelBreakdown[];
  topProducts: TopProduct[];
  hourlyTrends: HourlyTrend[];
  branchComparison: BranchSales[];
};

const formatMoney = (minor: number) =>
  (minor / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

const RANGES: Array<{ id: string; label: string }> = [
  { id: "today", label: "Bugün" },
  { id: "yesterday", label: "Dün" },
  { id: "week", label: "Son 7 Gün" },
  { id: "month", label: "Bu Ay" },
  { id: "all", label: "Tüm Zamanlar" },
];

export function ReportsPage({
  ctx,
  activeTab = "sales",
}: {
  ctx: ViewContext;
  activeTab?: string;
}) {
  const [range, setRange] = useState("today");
  const [data, setData] = useState<SalesAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branchApiId = ctx.selectedBranch?.apiId ?? null;

  const fetchAnalytics = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true);
      else setLoading(true);

      const actor =
        ctx.firmId === "11111111-1111-4111-8111-111111111111"
          ? "manager-single"
          : "manager-multi";

      const path = branchApiId
        ? `/api/v1/firms/${ctx.firmId}/branches/${branchApiId}/reports/sales-analytics?range=${range}`
        : `/api/v1/firms/${ctx.firmId}/reports/sales-analytics?range=${range}`;

      try {
        const response = await adminFetch(path, {
          firmId: ctx.firmId,
          demoActor: actor,
        });

        if (!response.ok) {
          const problem = (await response.json().catch(() => ({}))) as {
            message?: string;
          };
          throw new Error(
            problem.message ?? `Sunucu yanıtı başarısız (${response.status})`
          );
        }

        const json = (await response.json()) as SalesAnalyticsResponse;
        setData(json);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Raporlar yüklenemedi.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [ctx.firmId, branchApiId, range]
  );

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  const summary = data?.summary;
  const maxHourlyRevenue = Math.max(
    1,
    ...(data?.hourlyTrends.map((h) => h.revenueMinor) ?? [1])
  );

  return (
    <div className="reports-analytics-view" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Sayfa Başlığı */}
      <PageHeading
        eyebrow="İŞLETME RAPORLARI"
        title="Satış ve Ciro Analitiği"
        description={`${ctx.selectedBranch?.name ?? "Tüm Şubeler"} · Gerçek sipariş, ödeme ve adisyon kayıtlarından derlenen canlı raporlar.`}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className="button subtle"
              onClick={() => void fetchAnalytics(true)}
              disabled={refreshing || loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              <RefreshCw
                size={14}
                className={refreshing ? "spin-icon" : undefined}
                style={{
                  animation: refreshing ? "spin 1s linear infinite" : "none",
                }}
              />
              <span>Yenile</span>
            </button>
            <StatusPill tone="green">
              <CheckCircle2 size={12} style={{ marginRight: 4 }} /> Canlı Veritabanı
            </StatusPill>
          </div>
        }
      />

      {/* Tarih Aralığı Seçim Çubuğu */}
      <div
        className="card"
        style={{
          padding: "12px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Calendar size={18} style={{ color: "#7660de" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1f2937" }}>
            Tarih Kapsamı:
          </span>
          <div
            style={{
              display: "inline-flex",
              background: "#f3f4f6",
              padding: 3,
              borderRadius: 8,
              gap: 4,
            }}
          >
            {RANGES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRange(item.id)}
                style={{
                  background: range === item.id ? "#fff" : "transparent",
                  color: range === item.id ? "#4f46e5" : "#4b5563",
                  boxShadow:
                    range === item.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  border: "none",
                  borderRadius: 6,
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: range === item.id ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#6b7280" }}>
          <span>
            Kapsam: <b>{ctx.selectedBranch ? ctx.selectedBranch.name : "Tüm İşletme"}</b>
          </span>
          {data?.scope.from && data?.scope.to && (
            <span style={{ opacity: 0.8 }}>
              ({new Date(data.scope.from).toLocaleDateString("tr-TR")} –{" "}
              {new Date(data.scope.to).toLocaleDateString("tr-TR")})
            </span>
          )}
        </div>
      </div>

      {/* Hata Durumu */}
      {error && (
        <div
          className="card"
          style={{
            padding: 16,
            background: "#fef2f2",
            borderColor: "#f87171",
            color: "#991b1b",
          }}
        >
          <strong>Rapor Hatası:</strong> {error}
        </div>
      )}

      {/* Ana Metrik Kartları */}
      <div className="metric-grid compact-grid">
        <MetricCard
          icon={<Wallet size={23} />}
          title="TOPLAM BRÜT CİRO"
          value={formatMoney(summary?.grossRevenueMinor ?? 0)}
          foot={`Net: ${formatMoney(summary?.netRevenueMinor ?? 0)}${summary?.discountMinor ? ` · ${formatMoney(summary.discountMinor)} indirim` : ""}`}
          tone="green"
        />
        <MetricCard
          icon={<ReceiptText size={23} />}
          title="KAPANAN ADİSYON"
          value={String(summary?.completedChecksCount ?? 0)}
          foot={`Ortalama Sepet: ${formatMoney(summary?.averageCheckMinor ?? 0)}`}
          tone="blue"
        />
        <MetricCard
          icon={<Clock3 size={23} />}
          title="AÇIK MASALAR"
          value={String(summary?.openChecksCount ?? 0)}
          foot={`${formatMoney(summary?.openChecksBalanceMinor ?? 0)} bekleyen bakiye`}
          tone="purple"
        />
        <MetricCard
          icon={<TrendingUp size={23} />}
          title="SATILAN ÜRÜN"
          value={`${summary?.totalItemsSold ?? 0} adet`}
          foot={
            data?.topProducts[0]
              ? `Lider: ${data.topProducts[0].productName}`
              : "Sipariş verisi yok"
          }
          tone="orange"
        />
      </div>

      {/* Orta Grid: Ödeme ve Kanal Dağılımları */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 20,
        }}
      >
        {/* Ödeme Dağılımı (Nakit vs Kart) */}
        <div className="card report-card" style={{ margin: 0, padding: 20 }}>
          <div className="card-heading" style={{ marginBottom: 16 }}>
            <div>
              <span className="card-kicker">TAHSİLAT TÜRÜ</span>
              <h2>Ödeme Dağılımı</h2>
            </div>
            <StatusPill tone="blue">
              {summary ? formatMoney(summary.grossRevenueMinor) : "—"}
            </StatusPill>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data?.paymentBreakdown.map((item) => (
              <div key={item.method} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {item.method === "cash" ? (
                      <Banknote size={18} style={{ color: "#10b981" }} />
                    ) : (
                      <CreditCard size={18} style={{ color: "#3b82f6" }} />
                    )}
                    <strong>{item.label}</strong>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>
                      ({item.count} işlem)
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <b style={{ color: "#111827" }}>{formatMoney(item.amountMinor)}</b>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#4f46e5" }}>
                      %{item.percentage}
                    </span>
                  </div>
                </div>
                <div className="report-track" style={{ background: "#e5e7eb", height: 8 }}>
                  <span
                    style={{
                      width: `${item.percentage}%`,
                      background: item.method === "cash" ? "#10b981" : "#3b82f6",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sipariş Kanalı Dağılımı */}
        <div className="card report-card" style={{ margin: 0, padding: 20 }}>
          <div className="card-heading" style={{ marginBottom: 16 }}>
            <div>
              <span className="card-kicker">SATIŞ NOKTASI</span>
              <h2>Kanal Dağılımı</h2>
            </div>
            <StatusPill tone="purple">
              {data?.channelBreakdown.reduce((sum, c) => sum + c.count, 0) ?? 0} Sipariş
            </StatusPill>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data?.channelBreakdown.map((item) => (
              <div key={item.channel} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {item.channel === "table" ? (
                      <Utensils size={18} style={{ color: "#8b5cf6" }} />
                    ) : (
                      <ShoppingBag size={18} style={{ color: "#f59e0b" }} />
                    )}
                    <strong>{item.label}</strong>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>
                      ({item.count} adisyon)
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <b style={{ color: "#111827" }}>{formatMoney(item.amountMinor)}</b>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#8b5cf6" }}>
                      %{item.percentage}
                    </span>
                  </div>
                </div>
                <div className="report-track" style={{ background: "#e5e7eb", height: 8 }}>
                  <span
                    style={{
                      width: `${item.percentage}%`,
                      background: item.channel === "table" ? "#8b5cf6" : "#f59e0b",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alt Grid: En Çok Satan Ürünler & Saatlik Dağılım */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))",
          gap: 20,
        }}
      >
        {/* En Çok Satan Ürünler */}
        <div className="card report-card" style={{ margin: 0, padding: 20 }}>
          <div className="card-heading" style={{ marginBottom: 16 }}>
            <div>
              <span className="card-kicker">ÜRÜN PERFORMANSI</span>
              <h2>En Çok Satan 10 Ürün</h2>
            </div>
            <StatusPill tone="orange">
              {data?.topProducts.length ?? 0} Ürün
            </StatusPill>
          </div>

          {(!data?.topProducts || data.topProducts.length === 0) ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#6b7280" }}>
              Seçili tarih aralığında sipariş hareketi bulunamadı.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.topProducts.map((prod, index) => (
                <div
                  key={prod.productId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "30px 1fr 90px 100px",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 12,
                    paddingBottom: 8,
                    borderBottom: "1px solid #f3f4f6",
                  }}
                >
                  <strong style={{ color: "#9ca3af", textAlign: "center" }}>
                    {String(index + 1).padStart(2, "0")}
                  </strong>
                  <div>
                    <strong style={{ display: "block", color: "#111827", fontSize: 13 }}>
                      {prod.productName}
                    </strong>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>
                      {prod.categoryName}
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 700, color: "#4f46e5" }}>
                      {prod.quantity} adet
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <b style={{ display: "block", color: "#111827" }}>
                      {formatMoney(prod.totalRevenueMinor)}
                    </b>
                    <small style={{ color: "#6b7280", fontSize: 10 }}>
                      %{prod.percentage} ciro
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Saatlik Restoran Satış Nabzı */}
        <div className="card report-card" style={{ margin: 0, padding: 20 }}>
          <div className="card-heading" style={{ marginBottom: 16 }}>
            <div>
              <span className="card-kicker">GÜN İÇİ TRAFİK</span>
              <h2>Saatlik Satış Nabzı (08:00 – 23:00)</h2>
            </div>
            <StatusPill tone="blue">24 Saat</StatusPill>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              height: 180,
              padding: "20px 0 10px",
              borderBottom: "1px solid #e5e7eb",
              overflowX: "auto",
            }}
          >
            {data?.hourlyTrends
              .filter((h) => {
                const hourNum = parseInt(h.hour.split(":")[0] ?? "0", 10);
                return hourNum >= 8 && hourNum <= 23;
              })
              .map((h) => {
                const heightPct =
                  maxHourlyRevenue > 0
                    ? Math.round((h.revenueMinor / maxHourlyRevenue) * 100)
                    : 0;
                return (
                  <div
                    key={h.hour}
                    style={{
                      flex: 1,
                      minWidth: 24,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      height: "100%",
                      justifyContent: "flex-end",
                    }}
                    title={`${h.hour} · ${h.count} adisyon · ${formatMoney(h.revenueMinor)}`}
                  >
                    {h.count > 0 && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#4f46e5",
                        }}
                      >
                        {h.count}
                      </span>
                    )}
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 18,
                        height: `${Math.max(heightPct, h.count > 0 ? 8 : 2)}%`,
                        background:
                          h.count > 0
                            ? "linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)"
                            : "#f3f4f6",
                        borderRadius: "4px 4px 0 0",
                        transition: "height 0.3s ease",
                      }}
                    />
                    <span style={{ fontSize: 9, color: "#9ca3af", marginTop: 4 }}>
                      {h.hour.slice(0, 2)}
                    </span>
                  </div>
                );
              })}
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: "#6b7280",
            }}
          >
            <span>Sütun yüksekliği o saatteki brüt ciroyu gösterir.</span>
            <span>Rakamlar adisyon adedidir.</span>
          </div>
        </div>
      </div>

      {/* Şube Karşılaştırma Tablosu */}
      <div className="card report-card" style={{ padding: 20 }}>
        <div className="card-heading" style={{ marginBottom: 16 }}>
          <div>
            <span className="card-kicker">ŞUBE PERFORMANSI</span>
            <h2>Şube Karşılaştırma & Ciro Payı</h2>
          </div>
          <StatusPill tone="blue">
            {data?.branchComparison.length ?? 0} Şube
          </StatusPill>
        </div>

        {(!data?.branchComparison || data.branchComparison.length === 0) ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "#6b7280" }}>
            Şube verisi bulunamadı.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.branchComparison.map((b) => (
              <div
                key={b.branchId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px minmax(120px, 1fr) 140px",
                  alignItems: "center",
                  gap: 16,
                  fontSize: 12,
                }}
              >
                <div>
                  <strong style={{ display: "block", color: "#111827", fontSize: 13 }}>
                    {b.branchName}
                  </strong>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>
                    {b.checkCount} Kapanan Adisyon
                  </span>
                </div>
                <div className="report-track" style={{ background: "#f3f4f6", height: 10 }}>
                  <span
                    style={{
                      width: `${b.percentage}%`,
                      background: "#4f46e5",
                    }}
                  />
                </div>
                <div style={{ textAlign: "right" }}>
                  <b style={{ display: "block", color: "#111827", fontSize: 13 }}>
                    {formatMoney(b.revenueMinor)}
                  </b>
                  <span style={{ fontSize: 11, color: "#4f46e5", fontWeight: 600 }}>
                    %{b.percentage} Pay
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rapor Alt Menü Linkleri */}
      <div className="report-links">
        {sections
          .find((s) => s.id === "reports")
          ?.items.slice(0, 8)
          .map((item) => (
            <Link
              key={item.slug}
              to={`/admin/reports/${item.slug}`}
              style={{
                borderColor: activeTab === item.slug ? "#6366f1" : undefined,
                backgroundColor: activeTab === item.slug ? "#faf5ff" : undefined,
              }}
            >
              <ChartNoAxesCombined size={19} />
              <span>{item.label}</span>
              <ArrowRight size={16} />
            </Link>
          ))}
      </div>
    </div>
  );
}
