import { ArrowRight, Store } from "lucide-react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

export function BranchesPage({ ctx }: { ctx: ViewContext }) {
  const selected = ctx.selectedBranch;
  return <>
    <PageHeading eyebrow="ŞUBELER VE CANLI DURUM" title="Şube listesi"
      description="İşletmenin şubelerini seçin. Masa doluluğu ve açık adisyonlar ayrı Masa Planı ekranında izlenir."
      action={<StatusPill tone="blue">Şube kapsamı</StatusPill>} />
    <DemoNotice>Şube kartları bu önizlemede örnek işletme verisidir. Masa ve adisyon durumu şube kartlarından türetilmez.</DemoNotice>
    <div className="branch-list-grid">
      {ctx.branches.map((branch) => <button key={branch.id}
        className={`card branch-list-card ${selected?.id === branch.id ? "chosen" : ""}`}
        onClick={() => ctx.setBranchId(branch.id)} aria-pressed={selected?.id === branch.id}>
        <span className="branch-list-icon"><Store size={19} /></span>
        <span className="branch-list-copy"><strong>{branch.name}</strong><small>{branch.district}</small></span>
        <StatusPill tone={branch.health === "busy" ? "orange" : "green"}>
          {branch.health === "busy" ? "Yoğun" : "Normal"}
        </StatusPill>
        {selected?.id === branch.id && <small className="branch-list-selected">Seçili şube</small>}
      </button>)}
    </div>
    {selected && <section className="card branch-selected-summary">
      <div><span className="card-kicker">AKTİF ÇALIŞMA KAPSAMI</span><h2>{selected.name}</h2><p>{selected.district}</p></div>
      <Link to="/admin/branches/tables" className="primary-button branch-plan-link">Bu şubenin masa planını aç <ArrowRight size={15} /></Link>
    </section>}
  </>;
}
