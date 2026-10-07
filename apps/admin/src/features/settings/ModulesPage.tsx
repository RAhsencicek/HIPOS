import { Check, Clock3, Search, Store, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ViewContext } from "../../app/context";
import { useFeatureProvider } from "../../app/providers";
import type {
  BranchFeatureState,
  FeatureDefinition,
} from "../modules/contracts";
import { FeatureProviderError } from "../modules/contracts";
import { useFeatureCatalog } from "../modules/useFeatureCatalog";
import { Icon, StatusPill, PageHeading, DemoNotice } from "../../shared/ui";

function stateLabel(state: BranchFeatureState | undefined): string {
  if (!state) return "Durum bekleniyor";
  if (state.lifecycle === "draining") return "Kapanıyor · yeni iş kapalı";
  if (state.lifecycle === "setup_required")
    return "Açık tercih · kurulum gerekiyor";
  if (state.lifecycle === "provider_pending")
    return "Açık tercih · sağlayıcı bekleniyor";
  if (state.lifecycle === "disabled") return "Kapalı";
  if (state.effectiveForNewWork) return "Açık · backend yeni işe hazır";
  return "Açık tercih · önizleme";
}

export function ModulesPage({ ctx }: { ctx: ViewContext }) {
  const [category, setCategory] = useState("Tümü");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FeatureDefinition | null>(null);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const currentBranch = ctx.selectedBranch;
  const scope = currentBranch
    ? { firmId: ctx.firmId, branchId: currentBranch.apiId }
    : null;
  const load = useFeatureCatalog(scope);
  const { provider, source, notifyChange } = useFeatureProvider();
  const features = load.status === "success" ? load.definitions : [];
  const branchStates = load.status === "success" ? load.states : [];
  const categories = [
    "Tümü",
    ...new Set(features.map((feature) => feature.category)),
  ];
  useEffect(() => {
    setSelected(null);
    setNotice("");
    setErrorMessage("");
  }, [currentBranch?.apiId]);
  const filtered = features.filter(
    (feature) =>
      (category === "Tümü" || feature.category === category) &&
      `${feature.name} ${feature.description}`
        .toLocaleLowerCase("tr-TR")
        .includes(query.toLocaleLowerCase("tr-TR")),
  );
  const dependents = selected
    ? features.filter(
        (feature) =>
          branchStates.find((state) => state.key === feature.key)
            ?.desiredEnabled && feature.dependencies.includes(selected.key),
      )
    : [];
  const missing = selected
    ? selected.dependencies
        .filter((key) => {
          const state = branchStates.find((item) => item.key === key);
          return !state?.desiredEnabled || state.lifecycle !== "ready";
        })
        .map(
          (key) => features.find((feature) => feature.key === key)?.name ?? key,
        )
    : [];
  const selectedState = selected
    ? branchStates.find((state) => state.key === selected.key)
    : undefined;
  const isEnabled = selectedState?.desiredEnabled ?? false;
  async function toggleFeature() {
    if (!selected || !scope || !selectedState || saving) return;
    if (isEnabled && dependents.length) return;
    if (!isEnabled && missing.length) return;
    setSaving(true);
    setErrorMessage("");
    try {
      const next = await provider.setDesiredEnabled({
        ...scope,
        key: selected.key,
        desiredEnabled: !isEnabled,
        expectedVersion: selectedState.version,
      });
      notifyChange();
      setNotice(
        source === "http"
          ? `${selected.name} için ${currentBranch?.name} yerel prototip tercihi ${next.desiredEnabled ? "açıldı" : "kapatıldı"}. Yeni iş: ${next.effectiveForNewWork ? "backend pilotunda açık" : "kapalı"}. Gerçek işletme hesabı henüz bağlı değil.`
          : `${selected.name} için ${currentBranch?.name} önizleme tercihi ${next.desiredEnabled ? "açıldı" : "kapatıldı"}. Durum: ${next.lifecycle}. Gerçek işletme ayarı değişmedi.`,
      );
      setSelected(null);
    } catch (error) {
      if (
        error instanceof FeatureProviderError &&
        error.code === "VERSION_CONFLICT"
      ) {
        notifyChange();
      }
      setErrorMessage(
        error instanceof FeatureProviderError
          ? error.message
          : "Önizleme ayarı değiştirilemedi.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="AYARLAR"
        title="Modüller ve Özellikler"
        description="İhtiyacınız olan yönetim yeteneklerini şube bazında keşfedin ve önizleyin."
        action={
          <div className="module-count">
            <span>
              {load.status === "success" ? features.length : "—"} özellik
            </span>
            <StatusPill tone="purple">Katalog</StatusPill>
          </div>
        }
      />
      <DemoNotice>
        {source === "http"
          ? "Yerel .NET sunucu prototipine bağlı. Tercihler sunucunun bellek veya PostgreSQL ayarına göre saklanır; gerçek işletme ve kullanıcı hesabı henüz bağlı değildir."
          : "Bu katalog tasarım önizlemesidir. Açma/kapama seçimleri yalnız bu oturumdaki görünümü etkiler; veritabanına kayıt yapılmaz."}
      </DemoNotice>
      {!currentBranch && (
        <div className="notice branch-pick-notice">
          <Store size={16} />
          <span>Modül ayarını değiştirmek için bir şube seçin.</span>
          <select
            aria-label="Modül için şube seç"
            value=""
            onChange={(e) => ctx.setBranchId(e.target.value)}
          >
            <option value="" disabled>
              Şube seçin
            </option>
            {ctx.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {notice && (
        <div className="inline-message">
          <Check size={17} />
          {notice}
          <button onClick={() => setNotice("")} aria-label="Bildirimi kapat">
            <X size={15} />
          </button>
        </div>
      )}
      {errorMessage && (
        <div className="notice branch-pick-notice" role="alert">
          {errorMessage}
        </div>
      )}
      {load.status === "loading" && (
        <div className="card empty-list" role="status">
          <strong>Modül durumları yükleniyor</strong>
        </div>
      )}
      {load.status === "error" && (
        <div className="card empty-list" role="alert">
          <strong>
            {load.error.status === 403
              ? "Bu şubenin modül ayarlarına erişim yok"
              : "Modül durumu yüklenemedi"}
          </strong>
          <span>{load.error.message}</span>
        </div>
      )}
      {load.status === "success" && (
        <>
          <div className="card module-toolbar">
            <div className="table-search">
              <Search size={17} />
              <input
                aria-label="Modül ara"
                placeholder="Modül veya özellik ara..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="category-scroll">
              {categories.map((c) => (
                <button
                  className={category === c ? "chosen" : ""}
                  key={c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="modules-grid">
            {filtered.map((feature) => {
              const state = branchStates.find(
                (item) => item.key === feature.key,
              );
              const active = state?.desiredEnabled ?? false;
              return (
                <article className="card module-card" key={feature.key}>
                  <div className="module-card-top">
                    <div className="feature-icon">
                      <Icon name={feature.icon} size={21} />
                    </div>
                    <StatusPill
                      tone={
                        feature.availability === "prototype" || feature.availability === "backend_preview"
                          ? "purple"
                          : "neutral"
                      }
                    >
                      {feature.availability === "backend_preview"
                        ? "Backend pilotu"
                        : feature.availability === "prototype"
                        ? "Prototip"
                        : feature.availability === "planned"
                          ? "Planlandı"
                          : "Gerçek"}
                    </StatusPill>
                  </div>
                  <div className="module-category">{feature.category}</div>
                  <h2>{feature.name}</h2>
                  <p>{feature.description}</p>
                  <div className="module-card-bottom">
                    <div>
                      <span
                        className={`small-state ${state?.lifecycle === "ready" && active ? "on" : ""}`}
                      >
                        <i />
                        {currentBranch ? stateLabel(state) : "Şube seçin"}
                      </span>
                      <small>
                        {feature.setupRequirements?.length
                          ? "Kurulum gerekiyor"
                          : feature.providerRequired
                            ? "Sağlayıcı gerekli"
                            : feature.dependencies.length
                              ? `${feature.dependencies.length} bağımlılık`
                              : "Bağımsız özellik"}
                      </small>
                    </div>
                    <button
                      className={`toggle ${active ? "on" : ""}`}
                      role="switch"
                      aria-checked={active}
                      aria-label={`${feature.name} tercihini ${active ? "kapat" : "aç"}`}
                      disabled={
                        !currentBranch ||
                        !state ||
                        state.lifecycle === "draining"
                      }
                      onClick={() => setSelected(feature)}
                    >
                      <span />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="empty-list card">
              <Search size={25} />
              <strong>Modül bulunamadı</strong>
              <span>Aramanızı veya kategoriyi değiştirin.</span>
            </div>
          )}
        </>
      )}
      {selected && currentBranch && selectedState && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="module-dialog-title"
          >
            <div className="modal-top">
              <span className="feature-icon">
                <Icon name={selected.icon} size={23} />
              </span>
              <button
                className="icon-button"
                aria-label="Kapat"
                onClick={() => setSelected(null)}
              >
                <X size={19} />
              </button>
            </div>
            <span className="card-kicker">
              {currentBranch.name.toLocaleUpperCase("tr-TR")} · ÖNİZLEME
            </span>
            <h2 id="module-dialog-title">
              {selected.name} {isEnabled ? "kapatılsın mı?" : "açılsın mı?"}
            </h2>
            <p>{selected.description}</p>
            <div className="activation-plan">
              <strong>Aktivasyon planı</strong>
              <div>
                <Check size={16} /> Kapsam: yalnız {currentBranch.name}
              </div>
              <div>
                <Check size={16} /> Diğer şubeler etkilenmez
              </div>
              {selected.dependencies.map((key) => (
                <div key={key}>
                  <span
                    className={
                      branchStates.find((state) => state.key === key)
                        ?.lifecycle === "ready"
                        ? "plan-check"
                        : "plan-warn"
                    }
                  >
                    {branchStates.find((state) => state.key === key)
                      ?.lifecycle === "ready" ? (
                      <Check size={16} />
                    ) : (
                      <Clock3 size={16} />
                    )}
                  </span>{" "}
                  {features.find((f) => f.key === key)?.name ?? key} bağımlılığı
                </div>
              ))}
              {selected.setupRequirements?.map((requirement) => (
                <div key={requirement}>
                  <Clock3 size={16} className="warn-icon" /> {requirement}
                </div>
              ))}
              {selected.providerRequired && (
                <div>
                  <Clock3 size={16} className="warn-icon" /> Sağlayıcı
                  bağlantısı gerekli
                </div>
              )}
              {selected.availability === "planned" && (
                <div>
                  <Clock3 size={16} className="warn-icon" /> Gerçek işlem henüz
                  plan aşamasında
                </div>
              )}
              {selected.availability === "backend_preview" && (
                <div>
                  <Clock3 size={16} className="warn-icon" /> Gerçek taslak komutu yalnız yerel PostgreSQL API'de; panel formu ve kullanıcı girişi henüz bağlı değil
                </div>
              )}
              {isEnabled &&
                dependents.map((feature) => (
                  <div key={feature.key}>
                    <Clock3 size={16} className="warn-icon" /> {feature.name} bu
                    modüle bağlı ve açık
                  </div>
                ))}
            </div>
            <div className="modal-note">
              {selected.key === "catalog.drafts" && source === "http"
                ? "Bu tercih, PostgreSQL hazırsa yerel API'de gerçek taslak oluşturma/güncelleme iznini değiştirir. Panel formu henüz bağlı değildir; üretim hesabı değildir. Kapatma geçmiş taslakları silmez."
                : "Bu panelden gerçek işletme kaydı oluşturulmaz. Modül kapatıldığında yeni işler engellenir; geçmiş kayıtlar okunabilir kalır."}
            </div>
            <div className="modal-actions">
              <button className="soft-button" onClick={() => setSelected(null)}>
                Vazgeç
              </button>
              <button
                className="primary-button"
                disabled={
                  saving ||
                  selectedState.lifecycle === "draining" ||
                  (!isEnabled && missing.length > 0) ||
                  (isEnabled && dependents.length > 0)
                }
                onClick={toggleFeature}
              >
                {saving
                  ? "Önizleme güncelleniyor..."
                  : `Önizlemede ${isEnabled ? "kapat" : "aç"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
