import { PlugZap } from "lucide-react";
import { StatusPill, PageHeading, DemoNotice } from "../../shared/ui";

export function IntegrationsPage() {
  const groups = [
    {
      title: "Yemek platformları",
      names: ["Yemeksepeti", "GetirYemek", "Trendyol Yemek", "Migros Yemek"],
    },
    {
      title: "Ödeme ve mali",
      names: [
        "Banka / ödeme",
        "Sanal POS",
        "Yemek kartları",
        "ÖKC",
        "E-Fatura / E-Arşiv",
      ],
    },
    {
      title: "Cihaz ve operasyon",
      names: ["Yazıcı", "Terazi", "Caller ID", "Menuboard", "Muhasebe / ERP"],
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="AYARLAR"
        title="Entegrasyonlar"
        description="Harici sağlayıcı ve cihaz bağlantılarının planlanan kapsamı."
        action={<StatusPill tone="orange">Bağlantı kurulmadı</StatusPill>}
      />
      <DemoNotice>
        Bu aşamada hiçbir dış sağlayıcıya gerçek bağlantı kurulmamıştır.
      </DemoNotice>
      {groups.map((group) => (
        <section className="integration-section" key={group.title}>
          <h2>{group.title}</h2>
          <div className="integration-grid">
            {group.names.map((name) => (
              <article className="card integration-card" key={name}>
                <div className="integration-symbol">
                  <PlugZap size={20} />
                </div>
                <div>
                  <strong>{name}</strong>
                  <small>Gerçek sağlayıcı bağlantısı bekleniyor</small>
                </div>
                <StatusPill tone="orange">Sağlayıcı bekleniyor</StatusPill>
              </article>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
