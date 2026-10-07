import {
  ArrowRight,
  ChartNoAxesCombined,
  ReceiptText,
  Store,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Link } from "react-router";
import { formatMoney, sections } from "../../data/catalog";
import type { ViewContext } from "../../app/context";
import {
  StatusPill,
  PageHeading,
  MetricCard,
  DemoNotice,
} from "../../shared/ui";

export function ReportsPage({ ctx }: { ctx: ViewContext }) {
  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  return (
    <>
      <PageHeading
        eyebrow="RAPORLAR"
        title="İşletme raporları"
        description="Satış, ürün, kanal ve şube performansını seçili kapsamda inceleyin."
        action={<StatusPill tone="purple">Örnek projeksiyon</StatusPill>}
      />
      <DemoNotice>
        Bu raporlar örnek veriden üretilir; gerçek ödeme veya satış raporu
        olarak kullanılmamalıdır.
      </DemoNotice>
      <div className="metric-grid compact-grid">
        <MetricCard
          icon={<Wallet size={23} />}
          title="TOPLAM SATIŞ"
          value={formatMoney(branches.reduce((n, b) => n + b.sales, 0))}
          foot="Örnek günlük toplam"
          tone="green"
        />
        <MetricCard
          icon={<ReceiptText size={23} />}
          title="ADİSYON"
          value={String(branches.reduce((n, b) => n + b.openChecks, 0))}
          foot="Açık adisyonlar"
          tone="blue"
        />
        <MetricCard
          icon={<Store size={23} />}
          title="ŞUBE"
          value={String(branches.length)}
          foot="Senaryo kapsamı"
          tone="purple"
        />
        <MetricCard
          icon={<TrendingUp size={23} />}
          title="ORTALAMA"
          value={formatMoney(386)}
          foot="Örnek sepet tutarı"
          tone="orange"
        />
      </div>
      <div className="card report-card">
        <div className="card-heading">
          <div>
            <span className="card-kicker">ŞUBE KARŞILAŞTIRMA</span>
            <h2>Günlük satış dağılımı</h2>
          </div>
          <StatusPill tone="blue">
            {ctx.selectedBranch ? "Seçili şube" : "Seçili firma"}
          </StatusPill>
        </div>
        {branches.map((branch) => (
          <div className="report-row" key={branch.id}>
            <strong>{branch.name}</strong>
            <div className="report-track">
              <span style={{ width: `${(branch.sales / 70000) * 100}%` }} />
            </div>
            <b>{formatMoney(branch.sales)}</b>
          </div>
        ))}
        <p className="card-note">
          Ödeme ve satış toplamlarının ortak hesap kuralı gerçek backend
          aşamasında tanımlanacak.
        </p>
      </div>
      <div className="report-links">
        {sections
          .find((s) => s.id === "reports")
          ?.items.slice(0, 8)
          .map((item) => (
            <Link key={item.slug} to={`/admin/reports/${item.slug}`}>
              <ChartNoAxesCombined size={19} />
              <span>{item.label}</span>
              <ArrowRight size={16} />
            </Link>
          ))}
      </div>
    </>
  );
}
