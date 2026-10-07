import {
  Activity,
  ArrowRight,
  BookOpen,
  Boxes,
  CalendarDays,
  ChefHat,
  LayoutGrid,
  ReceiptText,
  Settings2,
  Store,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { checks, formatMoney } from "../../data/catalog";
import type { ViewContext } from "../../app/context";
import {
  DemoBadge,
  StatusPill,
  PageHeading,
  MetricCard,
  DemoNotice,
} from "../../shared/ui";

export function Dashboard({ ctx }: { ctx: ViewContext }) {
  const [period, setPeriod] = useState("Son 7 gün");
  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  const visibleChecks = checks.filter(
    (check) =>
      check.scenarioId === ctx.scenarioId &&
      (!ctx.selectedBranch || check.branchId === ctx.selectedBranch.id),
  );
  const sales = branches.reduce((sum, branch) => sum + branch.sales, 0);
  const openChecks = branches.reduce(
    (sum, branch) => sum + branch.openChecks,
    0,
  );
  const occupied = branches.reduce((sum, branch) => sum + branch.occupied, 0);
  const tables = branches.reduce((sum, branch) => sum + branch.tables, 0);
  const kitchen = branches.reduce((sum, branch) => sum + branch.kitchen, 0);
  const chart =
    period === "Bugün"
      ? [24, 31, 22, 40, 51, 72, 65, 83, 69, 76, 88, 94]
      : period === "Son 30 gün"
        ? [46, 57, 38, 65, 55, 76, 61, 82, 70, 91, 76, 98]
        : [32, 48, 41, 69, 54, 78, 87];
  return (
    <>
      <PageHeading
        eyebrow="PAZARTESİ, 5 EKİM 2026"
        title="İşletmenize genel bakış"
        description={`${ctx.selectedBranch?.name ?? `${branches.length} şube`} için güncel yönetim görünümü.`}
        action={
          <div className="heading-tools">
            <DemoBadge />
            <button className="soft-button" onClick={() => window.print()}>
              <CalendarDays size={16} /> Görünümü yazdır
            </button>
          </div>
        }
      />
      <DemoNotice />
      <div className="metric-grid">
        <MetricCard
          title="GÜNLÜK SATIŞ"
          value={formatMoney(sales)}
          foot="Bugün · örnek veri"
          icon={<Wallet size={25} />}
          tone="green"
          to="/admin/reports/sales"
        />
        <MetricCard
          title="AÇIK ADİSYONLAR"
          value={String(openChecks)}
          foot="Şu anda açık"
          icon={<ReceiptText size={25} />}
          tone="blue"
          to="/admin/sales/open"
        />
        <MetricCard
          title="DOLU MASALAR"
          value={`${occupied} / ${tables}`}
          foot={`%${Math.round((occupied / tables) * 100)} doluluk`}
          icon={<LayoutGrid size={25} />}
          tone="purple"
          to="/admin/branches/tables"
        />
        <MetricCard
          title="MUTFAKTA BEKLEYEN"
          value={String(kitchen)}
          foot="İzleme · salt okunur"
          icon={<ChefHat size={25} />}
          tone="orange"
          to="/admin/kitchen/jobs"
        />
      </div>
      <div className="dashboard-grid">
        <section className="card performance-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">PERFORMANS</span>
              <h2>Satış görünümü</h2>
            </div>
            <select
              aria-label="Grafik dönemi"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option>Bugün</option>
              <option>Son 7 gün</option>
              <option>Son 30 gün</option>
            </select>
          </div>
          <div className="chart-summary">
            <strong>{formatMoney(sales)}</strong>
            <span className="chart-change">
              <TrendingUp size={14} /> +%12,8
            </span>
            <small>Seçili kapsam için örnek toplam</small>
          </div>
          <div
            className="bar-chart"
            aria-label={`${period} örnek satış grafiği`}
          >
            {chart.map((height, i) => (
              <div className="bar-slot" key={i}>
                <div
                  className={`bar ${i === chart.length - 1 ? "highlight" : ""}`}
                  style={{ height: `${height}%` }}
                />
                <span>
                  {period === "Bugün"
                    ? `${i + 9}:00`
                    : period === "Son 30 gün"
                      ? `${i * 3 + 1}`
                      : ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"][i]}
                </span>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-dot purple" /> Satış tutarı
            </span>
            <Link to="/admin/reports/sales">
              Raporu aç <ArrowRight size={14} />
            </Link>
          </div>
        </section>
        <section className="card live-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">CANLI İZLEME</span>
              <h2>Şube durumu</h2>
            </div>
            <Link className="text-link" to="/admin/branches/list">
              Tümünü gör <ArrowRight size={15} />
            </Link>
          </div>
          <div className="branch-list">
            {branches.map((branch) => (
              <Link
                className="branch-row"
                to="/admin/branches/list"
                key={branch.id}
              >
                <div className="branch-symbol">
                  <Store size={19} />
                </div>
                <div className="branch-name">
                  <strong>{branch.name}</strong>
                  <small>{branch.district}</small>
                </div>
                <div className="branch-stats">
                  <strong>
                    {branch.occupied}/{branch.tables}
                  </strong>
                  <small>dolu masa</small>
                </div>
                <StatusPill
                  tone={branch.health === "busy" ? "orange" : "green"}
                >
                  {branch.health === "busy" ? "Yoğun" : "Normal"}
                </StatusPill>
              </Link>
            ))}
          </div>
          <div className="live-footer">
            <Activity size={16} />
            <span>Durumlar tasarım senaryosundan gelir.</span>
          </div>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="card table-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">SALT OKUNUR</span>
              <h2>Son adisyonlar</h2>
            </div>
            <Link className="text-link" to="/admin/sales/checks">
              Adisyonlara git <ArrowRight size={15} />
            </Link>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ADİSYON / MASA</th>
                  <th>KANAL</th>
                  <th>DURUM</th>
                  <th>TUTAR</th>
                  <th>ZAMAN</th>
                </tr>
              </thead>
              <tbody>
                {visibleChecks.map((check) => (
                  <tr key={check.id}>
                    <td>
                      <strong>{check.id}</strong>
                      <small>
                        {check.table} · {check.items}
                      </small>
                    </td>
                    <td>{check.channel}</td>
                    <td>
                      <StatusPill
                        tone={
                          check.status === "Hazırlanıyor"
                            ? "orange"
                            : check.status === "Ödeme bekliyor"
                              ? "purple"
                              : "green"
                        }
                      >
                        {check.status}
                      </StatusPill>
                    </td>
                    <td className="numeric">{formatMoney(check.total)}</td>
                    <td className="muted">{check.age}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleChecks.length === 0 && (
              <div className="empty-list">
                <ReceiptText size={24} />
                <strong>Bu şubede örnek adisyon yok</strong>
              </div>
            )}
          </div>
        </section>
        <section className="card quick-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">KISA YOLLAR</span>
              <h2>Sık kullanılanlar</h2>
            </div>
          </div>
          <div className="quick-links">
            <Link to="/admin/catalog/products">
              <span className="quick-icon purple">
                <BookOpen size={19} />
              </span>
              <span>
                <strong>Ürünler ve Menü</strong>
                <small>Ürünleri, fiyatları ve yayını incele</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/admin/inventory/summary">
              <span className="quick-icon orange">
                <Boxes size={19} />
              </span>
              <span>
                <strong>Stok ve Satın Alma</strong>
                <small>Kritik stokları ve talepleri gör</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/admin/settings/modules">
              <span className="quick-icon blue">
                <Settings2 size={19} />
              </span>
              <span>
                <strong>Modüller ve Özellikler</strong>
                <small>Şube kapsamlı özellikleri yönet</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
