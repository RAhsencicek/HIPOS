import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import type { NavSection } from "../data/catalog";
import { Icon, DemoBadge, StatusPill, PageHeading } from "./ui";

export function GenericPage({
  section,
  slug,
}: {
  section: NavSection;
  slug?: string;
}) {
  const item = section.items.find((entry) => entry.slug === slug);
  const title = item?.label ?? section.label;
  const readOnly = ["sales", "kitchen", "branches", "cash"].includes(
    section.id,
  );
  const planned = ["cash", "finance", "customers", "central"].includes(
    section.id,
  );
  return (
    <>
      <PageHeading
        eyebrow={section.label.toLocaleUpperCase("tr-TR")}
        title={title}
        description={`${section.label} alanındaki yönetim işleri ve bağlı ekranlar.`}
        action={
          <StatusPill tone={readOnly ? "blue" : planned ? "neutral" : "purple"}>
            {readOnly ? "Salt okunur" : planned ? "Planlandı" : "Prototip"}
          </StatusPill>
        }
      />
      <div className="generic-intro card">
        <div className="generic-intro-icon">
          <Icon name={section.icon} size={29} />
        </div>
        <div>
          <span className="card-kicker">ÜRÜN KAPSAMI</span>
          <h2>{title}</h2>
          <p>
            {readOnly
              ? "Bu alanda yönetici durumu izler. Sipariş, mutfak, servis veya tahsilat işlemi yapmaz."
              : planned
                ? "Bu alan ürün haritasında yer alır. Gerçek kayıt ve backend akışı henüz uygulanmamıştır."
                : "Bu alanın ekran ve akış tasarımı ilk frontend kapsamında görünür. Gerçek kaydetme henüz bağlı değildir."}
          </p>
          <div className="generic-tags">
            <StatusPill tone="purple">Yönetim paneli</StatusPill>
            <StatusPill tone="neutral">Şube kapsamı</StatusPill>
            <DemoBadge compact />
          </div>
        </div>
      </div>
      <div className="generic-section-title">
        <div>
          <span className="card-kicker">ALT EKRANLAR</span>
          <h2>Bu alanda neler var?</h2>
        </div>
        <span>{section.items.length} ekran</span>
      </div>
      <div className="generic-grid">
        {section.items.map((entry, i) => (
          <Link
            className={`card generic-tile ${entry.slug === slug ? "current" : ""}`}
            to={`/admin/${section.id}/${entry.slug}`}
            key={entry.slug}
          >
            <span className="tile-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{entry.label}</strong>
              <small>
                {readOnly
                  ? "İzleme ekranı"
                  : planned
                    ? "Planlanan yönetim akışı"
                    : "Ekran / akış tasarımı"}
              </small>
            </div>
            <ArrowRight size={16} />
          </Link>
        ))}
      </div>
      <div className="prototype-box">
        <div className="prototype-icon">
          <ShieldCheck size={20} />
        </div>
        <div>
          <strong>Gerçek işlem durumu açıkça gösterilir</strong>
          <p>
            Bu ekrandaki planlı işlevler kayıt oluşturmaz. Backend bağlantısı
            eklendiğinde gerçek işlem, hata ve yetki durumları aynı ürün
            sözleşmesine göre çalışacaktır.
          </p>
        </div>
      </div>
    </>
  );
}
