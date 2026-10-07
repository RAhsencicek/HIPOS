import { ArrowRight, LayoutGrid, Store } from "lucide-react";
import { Link } from "react-router";
import { formatMoney } from "../../data/catalog";
import type { ViewContext } from "../../app/context";
import { StatusPill, PageHeading, DemoNotice } from "../../shared/ui";

export function BranchesPage({ ctx }: { ctx: ViewContext }) {
  const selected = ctx.selectedBranch;
  return (
    <>
      <PageHeading
        eyebrow="ŞUBELER VE CANLI DURUM"
        title="Şube durumu"
        description="Şube, masa ve mutfak durumlarını yönetsel kapsamda izleyin."
        action={<StatusPill tone="blue">Salt okunur</StatusPill>}
      />
      <DemoNotice />
      <div className="branch-overview-grid">
        {ctx.branches.map((branch) => (
          <button
            key={branch.id}
            className={`card branch-overview ${selected?.id === branch.id ? "chosen" : ""}`}
            onClick={() => ctx.setBranchId(branch.id)}
          >
            <div className="branch-overview-head">
              <span className="branch-symbol">
                <Store size={20} />
              </span>
              <StatusPill tone={branch.health === "busy" ? "orange" : "green"}>
                {branch.health === "busy" ? "Yoğun" : "Normal"}
              </StatusPill>
            </div>
            <strong>{branch.name}</strong>
            <small>{branch.district}</small>
            <div className="branch-overview-data">
              <span>
                <b>
                  {branch.occupied}/{branch.tables}
                </b>{" "}
                masa
              </span>
              <span>
                <b>{branch.openChecks}</b> açık adisyon
              </span>
            </div>
          </button>
        ))}
      </div>
      {!selected ? (
        <div className="card select-branch-card">
          <Store size={25} />
          <strong>Masa planını görmek için bir şube seçin</strong>
          <span>Yukarıdaki şube kartlarından birini seçebilirsiniz.</span>
        </div>
      ) : (
        <div className="branch-detail-grid">
          <section className="card table-plan-card">
            <div className="card-heading">
              <div>
                <span className="card-kicker">SALT OKUNUR MASA PLANI</span>
                <h2>{selected.name}</h2>
              </div>
              <div className="table-legend">
                <span>
                  <i className="legend-dot purple" /> Dolu
                </span>
                <span>
                  <i className="legend-dot pale" /> Boş
                </span>
              </div>
            </div>
            <div className="table-plan">
              {Array.from({ length: Math.min(selected.tables, 24) }, (_, i) => (
                <div
                  key={i}
                  className={`restaurant-table ${i < selected.occupied ? "occupied" : ""}`}
                >
                  <LayoutGrid size={15} />
                  <span>{String(i + 1).padStart(2, "0")}</span>
                </div>
              ))}
            </div>
            <p className="card-note">
              Masa taşıma ve servis işlemleri yönetim panelinde yapılmaz.
            </p>
          </section>
          <section className="card branch-side-card">
            <span className="card-kicker">ANLIK ÖZET</span>
            <h2>Operasyon görünümü</h2>
            <div className="side-stat">
              <span>Açık adisyon</span>
              <strong>{selected.openChecks}</strong>
            </div>
            <div className="side-stat">
              <span>Mutfakta bekleyen</span>
              <strong>{selected.kitchen}</strong>
            </div>
            <div className="side-stat">
              <span>Masa doluluğu</span>
              <strong>
                %{Math.round((selected.occupied / selected.tables) * 100)}
              </strong>
            </div>
            <div className="side-stat">
              <span>Günlük satış</span>
              <strong>{formatMoney(selected.sales)}</strong>
            </div>
            <Link to="/admin/sales/open" className="subtle-link">
              Açık adisyonları incele <ArrowRight size={15} />
            </Link>
          </section>
        </div>
      )}
    </>
  );
}
