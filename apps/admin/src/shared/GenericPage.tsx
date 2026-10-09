import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import type { NavSection } from "../data/catalog";
import { featurePresentation } from "../data/featurePresentation";
import type { FeaturePresentation } from "../data/featurePresentation";
import { Icon, StatusPill, PageHeading } from "./ui";

type Sources = { catalogSource: "mock" | "http"; featureSource: "mock" | "http"; cariSource?: "mock" | "http"; serviceSource?: "mock" | "http" };

function tone(stage: FeaturePresentation["stage"]): "green" | "purple" | "orange" | "neutral" {
  return stage === "working" ? "green" : stage === "demo" ? "purple" :
    stage === "inactive" || stage === "setup" ? "orange" : "neutral";
}

export function GenericPage({ section, slug, sources }: {
  section: NavSection;
  slug?: string;
  sources: Sources;
}) {
  const item = section.items.find((entry) => entry.slug === slug);
  const selected = item ? featurePresentation(section.id, item.slug, sources) : null;
  return <>
    <PageHeading
      eyebrow={section.label.toLocaleUpperCase("tr-TR")}
      title={item?.label ?? section.label}
      description={item ? selected!.description : "Bu alanın bugün görülebilen ve sonraki aşamalarda gelecek alt ekranları."}
      action={selected && <StatusPill tone={tone(selected.stage)}>{selected.label}</StatusPill>}
    />
    <div className="generic-intro card">
      <div className="generic-intro-icon"><Icon name={section.icon} size={29} /></div>
      <div>
        <span className="card-kicker">{item ? "ÖZELLİK DURUMU" : "ALAN REHBERİ"}</span>
        <h2>{item?.label ?? section.label}</h2>
        <p>{item ? selected!.description : "Alt ekranlarda örnek ve çalışan işlevler, daha sonra gelecek işlerden ayrı gösterilir. Her ekran kendi durumunu açıkça belirtir."}</p>
        {selected && <StatusPill tone={tone(selected.stage)}>{selected.label}</StatusPill>}
      </div>
    </div>
    <SectionDirectory section={section} slug={slug} sources={sources} />
  </>;
}

export function SectionDirectory({ section, slug, sources }: {
  section: NavSection;
  slug?: string;
  sources: Sources;
}) {
  const current = section.items.filter((entry) =>
    featurePresentation(section.id, entry.slug, sources).stage !== "future");
  const future = section.items.filter((entry) =>
    featurePresentation(section.id, entry.slug, sources).stage === "future");

  function tile(entry: NavSection["items"][number], index: number) {
    const presentation = featurePresentation(section.id, entry.slug, sources);
    return <Link
      className={`card generic-tile ${entry.slug === slug ? "current" : ""} ${presentation.stage === "future" ? "future-tile" : ""}`}
      to={`/admin/${section.id}/${entry.slug}`}
      key={entry.slug}
      aria-current={entry.slug === slug ? "page" : undefined}
    >
      <span className="tile-number">{String(index + 1).padStart(2, "0")}</span>
      <div>
        <strong>{entry.label}</strong>
        <small>{presentation.description}</small>
        <StatusPill tone={tone(presentation.stage)}>{presentation.label}</StatusPill>
      </div>
      <ArrowRight size={16} />
    </Link>;
  }

  return <>
    <section aria-labelledby="available-screens">
      <div className="generic-section-title">
        <div><span className="card-kicker">ALT EKRANLAR</span><h2 id="available-screens">Bu alanda neler var?</h2></div>
        <span>{current.length} ekran</span>
      </div>
      {current.length ? <div className="generic-grid">{current.map(tile)}</div> :
        <div className="card generic-empty">Bu alanda henüz etkin veya örnek gösterimli alt ekran yok.</div>}
    </section>
    <section className="future-section" aria-labelledby="future-screens">
      <div className="generic-section-title">
        <div><span className="card-kicker">YOL HARİTASI</span><h2 id="future-screens">Gelecekte neler olacak?</h2></div>
        <span>{future.length} özellik</span>
      </div>
      {future.length ? <div className="generic-grid">{future.map(tile)}</div> :
        <div className="card generic-empty">Bu alan için ayrıca listelenmiş gelecek özellik yok.</div>}
    </section>
  </>;
}
