import { ChefHat, CreditCard, ReceiptText, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { checks, formatMoney } from "../../data/catalog";
import type { ViewContext } from "../../app/context";
import {
  StatusPill,
  PageHeading,
  MetricCard,
  DemoNotice,
} from "../../shared/ui";

type LiveOrder = {
  id: string;
  branchId: string;
  source: string;
  status: string;
  paymentStatus: string;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  createdAt: string;
  items: Array<{ productName: string; quantity: number }>;
};
const moneyMinor = (amountMinor: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amountMinor / 100);
const paymentLabel: Record<string, string> = {
  unpaid: "Ödenmedi", partially_paid: "Kısmi · simüle",
  paid: "Ödendi · simüle", pending: "Bekliyor · simüle", unknown: "Belirsiz · simüle",
};

function LiveSalesPage({ ctx }: { ctx: ViewContext }) {
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const branchId = ctx.selectedBranch?.apiId ?? null;
  useEffect(() => {
    let active = true;
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180";
    const actor = ctx.firmId === "11111111-1111-4111-8111-111111111111"
      ? "manager-single" : "manager-multi";
    const path = `/api/v1/firms/${ctx.firmId}/sales/orders${branchId ? `?branchId=${branchId}` : ""}`;
    setState("loading");
    async function refresh() {
      try {
        const response = await fetch(`${base}${path}`, { headers: { "X-Demo-Actor": actor } });
        if (!response.ok) {
          const problem = await response.json().catch(() => ({})) as { detail?: string };
          throw new Error(problem.detail ?? "Siparişler yüklenemedi.");
        }
        const data = await response.json() as { items: LiveOrder[] };
        if (active) { setOrders(data.items); setState("ready"); setError(""); }
      } catch (cause) {
        if (active) { setState("error"); setError(cause instanceof Error ? cause.message : "Bağlantı hatası."); }
      }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [ctx.firmId, branchId]);
  return <>
    <PageHeading eyebrow="SATIŞLAR VE ADİSYONLAR" title="Canlı sipariş görünümü"
      description="Test POS'tan veritabanına kaydedilen siparişler. Yönetici yalnız izler."
      action={<StatusPill tone="blue">Salt okunur · 5 sn yenileme</StatusPill>} />
    <div className="notice" role="status">Geliştirme önizlemesi: Siparişler veritabanındadır; ödeme durumları yalnız simülatördendir. Gerçek tahsilat yapılmaz.</div>
    {state === "loading" && <div className="card empty-list" role="status">Siparişler yükleniyor…</div>}
    {state === "error" && <div className="card empty-list" role="alert">{error}</div>}
    {state === "ready" && <div className="card content-card">
      <div className="card-heading padded"><div><span className="card-kicker">GERÇEK VERİTABANI KAYDI</span><h2>Son siparişler</h2></div></div>
      {orders.length === 0 ? <div className="empty-list">Bu kapsamda henüz test POS siparişi yok.</div> :
        <div className="table-scroll"><table><thead><tr>
          <th>SİPARİŞ</th><th>ŞUBE</th><th>ÜRÜNLER</th><th>DURUM</th><th>ÖDEME</th><th>TOPLAM</th><th>AÇILIŞ</th>
        </tr></thead><tbody>{orders.map((order) => <tr key={order.id}>
          <td><strong>{order.id.slice(0, 8)}</strong><small>Test POS</small></td>
          <td>{ctx.branches.find((branch) => branch.apiId === order.branchId)?.name ?? order.branchId}</td>
          <td>{order.items.map((item) => `${item.quantity}× ${item.productName}`).join(", ")}</td>
          <td><StatusPill tone="blue">Açık</StatusPill></td>
          <td><StatusPill tone={order.paymentStatus === "paid" ? "green" : order.paymentStatus === "unknown" ? "orange" : "purple"}>
            {paymentLabel[order.paymentStatus] ?? order.paymentStatus}
          </StatusPill><small>Ödenen: {moneyMinor(order.paidMinor)} · Kalan: {moneyMinor(order.remainingMinor)}</small></td>
          <td className="numeric strong">{moneyMinor(order.totalMinor)}</td>
          <td className="muted">{new Date(order.createdAt).toLocaleString("tr-TR")}</td>
        </tr>)}</tbody></table></div>}
      <div className="table-footer">{orders.length} kayıt · en fazla son 100 sipariş</div>
    </div>}
  </>;
}

export function SalesPage({ ctx }: { ctx: ViewContext }) {
  return import.meta.env.VITE_SALES_PROVIDER === "http"
    ? <LiveSalesPage ctx={ctx} /> : <MockSalesPage ctx={ctx} />;
}

function MockSalesPage({ ctx }: { ctx: ViewContext }) {
  const [status, setStatus] = useState("Tümü");
  const scoped = checks.filter(
    (check) =>
      check.scenarioId === ctx.scenarioId &&
      (!ctx.selectedBranch || check.branchId === ctx.selectedBranch.id),
  );
  const visible =
    status === "Tümü"
      ? scoped
      : scoped.filter((check) => check.status === status);
  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  return (
    <>
      <PageHeading
        eyebrow="SATIŞLAR VE ADİSYONLAR"
        title="Adisyon görünümü"
        description="Siparişleri, kanalları ve durumları inceleyin. Bu alan operasyon eylemi içermez."
        action={<StatusPill tone="blue">Salt okunur</StatusPill>}
      />
      <DemoNotice />
      <div className="metric-grid compact-grid">
        <MetricCard
          icon={<ReceiptText size={23} />}
          title="AÇIK ADİSYON"
          value={String(
            branches.reduce((sum, branch) => sum + branch.openChecks, 0),
          )}
          foot="Örnek senaryo"
          tone="blue"
        />
        <MetricCard
          icon={<ChefHat size={23} />}
          title="HAZIRLANIYOR"
          value={String(
            branches.reduce((sum, branch) => sum + branch.kitchen, 0),
          )}
          foot="Mutfak izleme"
          tone="orange"
        />
        <MetricCard
          icon={<CreditCard size={23} />}
          title="ÖDEME BEKLEYEN"
          value={String(
            scoped.filter((check) => check.status === "Ödeme bekliyor").length,
          )}
          foot="Tahsilat yapılmaz"
          tone="purple"
        />
        <MetricCard
          icon={<TrendingUp size={23} />}
          title="GÜNLÜK SATIŞ"
          value={formatMoney(
            branches.reduce((sum, branch) => sum + branch.sales, 0),
          )}
          foot="Örnek rapor verisi"
          tone="green"
        />
      </div>
      <div className="card content-card">
        <div className="card-heading padded">
          <div>
            <span className="card-kicker">SALT OKUNUR</span>
            <h2>Son adisyonlar</h2>
          </div>
          <select
            aria-label="Adisyon durum filtresi"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              "Tümü",
              "Hazırlanıyor",
              "Serviste",
              "Hazır",
              "Ödeme bekliyor",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ADİSYON</th>
                <th>MASA / KANAL</th>
                <th>İÇERİK</th>
                <th>DURUM</th>
                <th>TOPLAM</th>
                <th>AÇILIŞ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((check) => (
                <tr key={check.id}>
                  <td>
                    <strong>{check.id}</strong>
                  </td>
                  <td>
                    {check.table}
                    <small>{check.channel}</small>
                  </td>
                  <td>{check.items}</td>
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
                  <td className="numeric strong">{formatMoney(check.total)}</td>
                  <td className="muted">{check.age}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          {visible.length} adisyon · örnek veri
        </div>
      </div>
    </>
  );
}
