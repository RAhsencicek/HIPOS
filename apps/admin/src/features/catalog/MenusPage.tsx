import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, Eye, Layers, Package, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { ViewContext } from "../../app/context";
import { MetricCard, PageHeading, StatusPill } from "../../shared/ui";
import { formatCatalogMoney } from "./formatters";
import { HttpMenuProvider, MenuApiError, sampleMenus } from "./MenuProvider";
import type { MenuSection, MenuWorkspace, RestaurantMenu } from "./MenuProvider";

type Draft = { name: string; description: string; sections: MenuSection[] };
const emptyDraft = (): Draft => ({ name: "", description: "", sections: [] });
const copyDraft = (menu: RestaurantMenu): Draft => ({ name: menu.name, description: menu.description,
  sections: menu.sections.map(s => ({ ...s, productIds: [...s.productIds] })) });
function move<T>(array: T[], from: number, to: number): T[] {
  const next = [...array];
  if (to < 0 || to >= next.length) return next;
  const [value] = next.splice(from, 1); next.splice(to, 0, value); return next;
}

export function MenusPage({ ctx, source, canWrite }: { ctx: ViewContext; source: "http" | "mock"; canWrite: boolean }) {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("menu");
  const previewOnly = params.get("view") === "preview";
  const [workspace, setWorkspace] = useState<MenuWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [baseline, setBaseline] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [newSectionName, setNewSectionName] = useState("");
  const [pickerSectionId, setPickerSectionId] = useState<string | null>(null);
  const [pickerCategoryId, setPickerCategoryId] = useState("all");
  const [pickerQuery, setPickerQuery] = useState("");
  const [categoryToAdd, setCategoryToAdd] = useState("");
  const [activation, setActivation] = useState<RestaurantMenu | null>(null);
  const [pendingRetry, setPendingRetry] = useState<(() => Promise<{ id: string }>) | null>(null);
  const alive = useRef(true);
  const requestSerial = useRef(0);
  const provider = useMemo(() => new HttpMenuProvider(), []);
  const scope = useMemo(() => ({ firmId: ctx.firmId, branchId: ctx.branchApiId }), [ctx.firmId, ctx.branchApiId]);
  const selected = workspace?.items.find(x => x.id === selectedId);
  const dirty = Boolean(selectedId && !previewOnly && baseline && JSON.stringify(draft) !== baseline);
  const editable = source === "http" && canWrite && !busy && !pendingRetry;

  const reload = useCallback(async () => {
    const serial = ++requestSerial.current;
    if (!scope.branchId) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = source === "http" ? await provider.load(scope) : sampleMenus(scope);
      if (alive.current && serial === requestSerial.current) setWorkspace(data);
    } catch (reason) { if (alive.current && serial === requestSerial.current) setError((reason as Error).message); }
    finally { if (alive.current && serial === requestSerial.current) setLoading(false); }
  }, [provider, scope, source]);
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; requestSerial.current++; }; }, [reload]);
  useEffect(() => {
    if (!workspace) return;
    const next = selected ? copyDraft(selected) : emptyDraft();
    setDraft(next); setBaseline(JSON.stringify(next)); setQuery(""); setCategoryToAdd(""); setNewSectionName(""); setPickerSectionId(null); setPickerQuery("");
  }, [selectedId, workspace, selected]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function open(id: string | null, preview = false) {
    if (busy || pendingRetry || (dirty && !window.confirm("Kaydedilmemiş değişiklikler var. Ayrılmak istiyor musunuz?"))) return;
    setError(""); setNotice("");
    setParams(id ? { menu: id, ...(preview ? { view: "preview" } : {}) } : {});
  }
  async function write(action: () => Promise<{ id: string }>, message: string) {
    if (!canWrite || busy || source !== "http") return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action();
      if (!alive.current) return;
      setPendingRetry(null); setActivation(null); setNotice(message); setParams({ menu: result.id });
      await reload();
    } catch (reason) {
      if (!alive.current) return;
      const failure = reason as MenuApiError;
      setActivation(null);
      setError(failure.message);
      if (failure.code === "LOAD_FAILED") setPendingRetry(() => action);
    } finally { if (alive.current) setBusy(false); }
  }
  function save() {
    const body = { ...draft, requestId: crypto.randomUUID(), expectedVersion: selected?.version ?? 0 };
    void write(() => provider.save(scope, selected?.id ?? null, body), "Menü kaydedildi. Değişiklikler kalıcı olarak saklanıyor.");
  }
  const active = workspace?.items.find(x => x.isActive);
  const productById = new Map(workspace?.products.map(x => [x.id, x]));
  const categoryById = new Map(workspace?.categories.map(x => [x.id, x]));
  const selectedProducts = selected?.sections.flatMap(section => section.productIds.map(id => productById.get(id))) ?? [];
  const publishReady = Boolean(selected && selected.sections.length && selected.sections.every(section => section.productIds.length > 0) && selectedProducts.length > 0 &&
    selectedProducts.every(product => product?.status === "published" && product.price.amountMinor > 0));
  const publishBlocker = !selected?.sections.length ? "Önce menüye bölüm ve ürün ekleyin." : selected.sections.some(section => section.productIds.length === 0)
    ? "Yayına almak için boş menü bölümlerine ürün ekleyin veya boş bölümü kaldırın."
    : selectedProducts.some(product => !product || product.status !== "published" || product.price.amountMinor <= 0)
      ? "Yayına almak için ürünleri yayınlayın ve geçerli bir fiyat tanımlayın." : "";
  const pickerSection = draft.sections.find(section => section.sectionId === pickerSectionId);
  const pickerUsedElsewhere = new Set(draft.sections.filter(section => section.sectionId !== pickerSectionId).flatMap(section => section.productIds));
  const pickerProducts = workspace?.products.filter(product => {
    const matchesCategory = pickerCategoryId === "all" || product.categoryId === pickerCategoryId;
    const matchesSearch = `${product.name} ${categoryById.get(product.categoryId)?.name ?? ""}`.toLocaleLowerCase("tr-TR").includes(pickerQuery.trim().toLocaleLowerCase("tr-TR"));
    return matchesCategory && matchesSearch;
  }) ?? [];
  const count = draft.sections.reduce((sum, s) => sum + s.productIds.length, 0);
  const shownMenus = workspace?.items.filter(x => `${x.name} ${x.description}`.toLocaleLowerCase("tr-TR").includes(query.toLocaleLowerCase("tr-TR"))) ?? [];

  return <>
    <PageHeading eyebrow="ÜRÜNLER VE MENÜ" title={selectedId ? previewOnly ? "Menü önizlemesi" : selectedId === "new" ? "Yeni menü" : "Menüyü düzenle" : "Menüler"}
      description={selectedId ? "Menünüzün içeriğini ve sırasını düzenleyin; güncel ürün fiyatlarını birlikte görün." : "İşletmenizin menülerini hazırlayın, içeriklerini düzenleyin ve aktif menünüzü seçin."}
      action={<><StatusPill tone={source === "http" ? "green" : "purple"}>{source === "http" ? "Kalıcı kayıt" : "Örnek gösterim"}</StatusPill>
        {!selectedId && <button className="primary-button" disabled={!editable || loading || !workspace} onClick={() => open("new")}><Plus size={17} />Yeni menü</button>}
        {selectedId && <button className="soft-button" disabled={busy || Boolean(pendingRetry)} onClick={() => open(null)}><ArrowLeft size={16} />Menülere dön</button>}</>} />
    {source === "mock" && <div className="notice" role="status">Örnek gösterim · Menü içeriği tanıtım amaçlıdır; değişiklik kaydedilmez.</div>}
    {source === "http" && !canWrite && <div className="notice" role="status">Menüler salt okunur. Düzenleme için <Link to="/admin/settings/modules">Menü Yönetimi modülünü etkinleştirin</Link>.</div>}
    {!scope.branchId && <div className="card generic-empty">Menüleri görmek için bir şube seçin.</div>}
    {error && <div className="notice" role="alert">{error} {pendingRetry ? <><span> Sonuç belirsiz; aynı istekle tekrar deneyebilirsiniz.</span><button className="soft-button" disabled={busy || !canWrite} onClick={() => void write(pendingRetry, "İstek doğrulandı; menü kaydı güncel.")}>Aynı isteği tekrar dene</button></>
      : <button className="soft-button" disabled={busy} onClick={() => { if (!dirty || window.confirm("Güncel kaydı yüklemek kaydedilmemiş değişiklikleri kaldırır. Devam edilsin mi?")) { setError(""); void reload(); } }}>Güncel kayıtları yükle</button>}</div>}
    {notice && <div className="notice menu-success" role="status"><Check size={17} />{notice}</div>}
    {loading && <div className="notice" role="status">Menüler yükleniyor…</div>}
    {workspace && scope.branchId && !selectedId && <>
      <div className="menu-metrics">
        <MetricCard icon={<BookOpen size={21} />} title="Menüler" value={String(workspace.items.length)} foot={`${ctx.selectedBranch?.name} için hazırlanan menüler`} />
        <MetricCard icon={<Layers size={21} />} title="Kategoriler" value={String(workspace.categories.length)} foot="Ürün kataloğundaki kategori sayısı" tone="blue" />
        <MetricCard icon={<Package size={21} />} title="Ürünler" value={String(workspace.products.length)} foot="Menülere ekleyebileceğiniz şube ürünleri" tone="orange" />
      </div>
      <section className="menu-hero card">
        <div><span className="card-kicker">ŞUBEDE YAYINDA</span><h2>{active?.name ?? "Henüz şubede yayımlanmış menü yok"}</h2>
          <p>{active?.description || "Önce menünüzü hazırlayın, ardından bu şube için aktif menü olarak seçin."}</p>
          {active && <span>{active.sections.length} menü bölümü · {active.sections.reduce((n, s) => n + s.productIds.length, 0)} ürün</span>}
          <small>Bu menü yalnızca seçili şubede yayındadır. POS, QR ve web sitesi bağlantıları henüz etkin değildir; QR/web yayını sonraki fazda planlanmaktadır.</small>
        </div>{active && <button className="soft-button" onClick={() => open(active.id, true)}><Eye size={16} />Menüyü görüntüle</button>}
      </section>
      <div className="menu-list-heading"><div><h2>Menü listesi</h2><p>Menüleri açarak içeriklerini düzenleyebilir veya önizleyebilirsiniz.</p></div>
        <label className="menu-search"><Search size={17} /><input aria-label="Menü ara" placeholder="Menü ara…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
      <div className="menu-card-grid">{shownMenus.map(menu => <article className={`card menu-card ${menu.isActive ? "is-active" : ""}`} key={menu.id}>
        <header><span className="menu-card-icon"><BookOpen size={23} /></span><StatusPill tone={menu.isActive ? "green" : "neutral"}>{menu.isActive ? "Şubede yayında" : "Taslak"}</StatusPill></header>
        <h3>{menu.name}</h3><p>{menu.description || "Bu menüye henüz açıklama eklenmedi."}</p>
        <div className="menu-card-counts"><span><Layers size={15} />{menu.sections.length} menü bölümü</span><span><Package size={15} />{menu.sections.reduce((n, s) => n + s.productIds.length, 0)} ürün</span></div>
        <div className="menu-category-chips">{menu.sections.slice(0, 4).map(s => <span key={s.sectionId}>{s.name}</span>)}{menu.sections.length > 4 && <span>+{menu.sections.length - 4}</span>}</div>
        <small>Son düzenleme: {new Date(menu.updatedAt).toLocaleDateString("tr-TR")} · Sürüm {menu.version}</small>
        <footer><button className="soft-button" onClick={() => open(menu.id, true)}><Eye size={15} />Önizle</button><button className="primary-button" onClick={() => open(menu.id)}><Pencil size={15} />{canWrite ? "Düzenle" : "İncele"}</button></footer>
      </article>)}</div>
      {!shownMenus.length && <div className="card generic-empty"><BookOpen size={25} /><strong>{query ? "Aramanızla eşleşen menü yok" : "İlk menünüzü hazırlayın"}</strong><p>Kategorilerinizi ve ürünlerinizi seçerek işletmenize ait menüyü oluşturun.</p></div>}
      <div className="menu-shortcuts"><Link to="/admin/catalog/categories">Kategorileri incele <ArrowRight size={16} /></Link><Link to="/admin/catalog/products">Ürünleri yönet <ArrowRight size={16} /></Link><Link to="/admin/catalog/prices">Fiyatlar <ArrowRight size={16} /></Link></div>
    </>}
    {workspace && selectedId && selectedId !== "new" && !selected && !loading && <div className="card generic-empty">Bu şubede menü bulunamadı.</div>}
    {workspace && selectedId && (selected || selectedId === "new") && <>
      <div className="menu-editor-top"><span>{selected?.isActive ? "Aktif menü" : "Pasif menü"} · {draft.sections.length} menü bölümü · {count} ürün{dirty ? " · Kaydedilmemiş değişiklikler" : ""}</span>
        {!previewOnly && <button className="primary-button" disabled={!editable || draft.name.trim().length < 2 || (!dirty && Boolean(selected))} onClick={save}><Check size={16} />{busy ? "Kaydediliyor…" : "Değişiklikleri kaydet"}</button>}
        {previewOnly && canWrite && <button className="primary-button" onClick={() => open(selectedId)}><Pencil size={16} />Menüyü düzenle</button>}</div>
      <div className={`menu-editor-layout ${previewOnly ? "preview-only" : ""}`}>
        {!previewOnly && <section className="menu-editor-fields" aria-label="Menü düzenleyici">
          <div className="card menu-editor-card"><span className="card-kicker">MENÜ BİLGİLERİ</span><h2>Ad ve açıklama</h2>
            <label>Menü adı<input value={draft.name} minLength={2} maxLength={160} disabled={!editable} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Örn. Ana Menü" /></label>
            <label>Açıklama<textarea value={draft.description} maxLength={1000} disabled={!editable} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Menüyü kısaca tanıtın…" rows={3} /></label>
          </div>
          <div className="card menu-editor-card"><span className="card-kicker">MENÜ İÇERİĞİ</span><h2>Bölümler ve ürünler</h2><p>Katalog kategorisini hazır bölüm olarak ekleyin veya özel bir başlık oluşturun. Her bölüme mevcut ürünleri arayıp ekleyin; oklarla menü sırasını düzenleyin.</p>
            <div className="menu-add-category"><select aria-label="Eklenecek kategori" value={categoryToAdd} disabled={!editable} onChange={e => setCategoryToAdd(e.target.value)}>
              <option value="">Kategori seçin</option>{workspace.categories.filter(c => c.isActive && !draft.sections.some(s => s.sectionId === `catalog-${c.id}`)).map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
              <button className="soft-button" disabled={!editable || !categoryToAdd} onClick={() => { const category = workspace.categories.find(c => c.id === categoryToAdd)!;
                setDraft({ ...draft, sections: [...draft.sections, { sectionId: `catalog-${category.id}`, name: category.name, productIds: [] }] }); setCategoryToAdd(""); }}><Plus size={16} />Ekle</button></div>
            <div className="menu-custom-section"><label>Özel menü başlığı<input aria-label="Özel bölüm adı" maxLength={120} placeholder="Örn. Kahvaltı Favorileri" value={newSectionName} disabled={!editable} onChange={e => setNewSectionName(e.target.value)} /></label>
              <button className="soft-button" disabled={!editable || newSectionName.trim().length < 2} onClick={() => {
                const name = newSectionName.trim();
                if (draft.sections.some(s => s.name.trim().toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"))) { setError("Bu menüde aynı başlık zaten var."); return; }
                setError(""); setDraft({ ...draft, sections: [...draft.sections, { sectionId: `custom-${crypto.randomUUID()}`, name, productIds: [] }] }); setNewSectionName("");
              }}><Plus size={16} />Özel başlık ekle</button></div>
            {draft.sections.map((section, sectionIndex) => {
              const ordered = section.productIds.map(id => productById.get(id)).filter(p => p !== undefined);
              const changeProducts = (productIds: string[]) => setDraft({ ...draft, sections: draft.sections.map((s, i) => i === sectionIndex ? { ...s, productIds } : s) });
              const linkedCategory = workspace.categories.find(category => category.id === section.sectionId || `catalog-${category.id}` === section.sectionId);
              return <div className="menu-section-editor" key={section.sectionId}>
                <header><div><h3>{section.name}</h3><small>{section.productIds.length} ürün seçildi · {linkedCategory ? "Katalog kategorisinden bölüm" : "Bu menüye özel başlık"}</small></div>
                  <div className="menu-order-controls"><button aria-label={`${section.name} başlığını yukarı taşı`} disabled={!editable || sectionIndex === 0} onClick={() => setDraft({ ...draft, sections: move(draft.sections, sectionIndex, sectionIndex - 1) })}><ChevronUp size={16} /></button>
                    <button aria-label={`${section.name} başlığını aşağı taşı`} disabled={!editable || sectionIndex === draft.sections.length - 1} onClick={() => setDraft({ ...draft, sections: move(draft.sections, sectionIndex, sectionIndex + 1) })}><ChevronDown size={16} /></button>
                    <button aria-label={`${section.name} başlığını menüden çıkar`} disabled={!editable} onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, i) => i !== sectionIndex) })}><Trash2 size={16} /></button></div></header>
                <label className="menu-section-name">Menüde görünecek başlık<input value={section.name} maxLength={120} disabled={!editable}
                  onChange={e => setDraft({ ...draft, sections: draft.sections.map((s, i) => i === sectionIndex ? { ...s, name: e.target.value } : s) })} /></label>
                {ordered.map(product => {
                  const index = section.productIds.indexOf(product.id);
                  return <div className={`menu-pick-row ${index >= 0 ? "selected" : ""}`} key={product.id}><span className="menu-product-thumb" aria-hidden="true">{product.image || "🍽️"}</span><div className="menu-picked-details"><strong>{product.name}</strong><small>{categoryById.get(product.categoryId)?.name ?? "Ürün"} · {product.status === "draft" ? "Taslak ürün · aktif menüde kullanılamaz" : formatCatalogMoney(product.price)}</small></div>
                    {index >= 0 && <div className="menu-order-controls"><button aria-label={`${product.name} ürününü yukarı taşı`} disabled={!editable || index === 0} onClick={() => changeProducts(move(section.productIds, index, index - 1))}><ChevronUp size={15} /></button>
                      <button aria-label={`${product.name} ürününü aşağı taşı`} disabled={!editable || index === section.productIds.length - 1} onClick={() => changeProducts(move(section.productIds, index, index + 1))}><ChevronDown size={15} /></button></div>}
                    <button className="menu-remove-product" aria-label={`${product.name} ürününü bu bölümden çıkar`} disabled={!editable} onClick={() => changeProducts(section.productIds.filter(id => id !== product.id))}><X size={15} /></button></div>;
                })}
                {!ordered.length && <div className="menu-section-empty">Bu bölümde henüz ürün yok.</div>}
                <button className="menu-open-picker" disabled={!editable} onClick={() => { setPickerSectionId(section.sectionId); setPickerCategoryId(linkedCategory?.id ?? "all"); setPickerQuery(""); }}>
                  <Plus size={16} />Ürün seç<span>{linkedCategory ? `${linkedCategory.name} ürünleri seçili` : "Katalogdaki mevcut ürünleri seç"}</span>
                </button>
              </div>;
            })}
            {!draft.sections.length && <div className="menu-inline-empty">Katalog kategorisi ekleyin veya kendi bölüm başlığınızı oluşturun.</div>}
          </div>
          {selected && <div className="card menu-editor-card menu-activation"><h2>{selected.isActive ? "Bu şubede yayında" : "Şubede yayına al"}</h2><p>{selected.isActive ? "Bu menü seçili şubede kullanıma açık. POS, QR veya web sitesine otomatik aktarım yapmaz." : `Yayına almak bu menüyü seçili şubede kullanıma açar.${active ? ` “${active.name}” yayından kaldırılır.` : ""} QR ve web sitesi yayını sonraki fazda.`}</p>
            <button className="primary-button" disabled={!editable || dirty || (!selected.isActive && !publishReady)} onClick={() => setActivation(selected)}>{selected.isActive ? "Şubede yayından kaldır" : "Şubede yayına al"}</button>
            {dirty && <small>Önce menü içeriğini kaydedin.</small>}{!selected.isActive && !publishReady && <small>{publishBlocker}</small>}</div>}
        </section>}
        <aside className="menu-preview" aria-label="Menü önizlemesi"><div className="menu-preview-board"><div className="menu-preview-kicker"><BookOpen size={15} />MENÜ TASLAĞI · TIKLANABİLİR DEĞİL{dirty && <span>Kaydedilmedi</span>}</div><span className="menu-preview-brand">{ctx.firm}</span><h2>{draft.name || "Menü adı"}</h2><p>{draft.description || "Lezzetlerimizi keşfedin."}</p>
          {draft.sections.map(s => <section key={s.sectionId}><h3>{s.name}</h3>{s.productIds.map(id => {
            const product = productById.get(id); return product ? <div className="menu-preview-product" key={id}><span>{product.name}</span><strong>{formatCatalogMoney(product.price)}</strong></div>
              : <div className="notice" key={id}>Ürün artık bu şubede bulunamıyor.</div>;
          })}{!s.productIds.length && <small>Bu bölüm henüz boş.</small>}</section>)}
          {!draft.sections.length && <div className="menu-inline-empty"><BookOpen size={28} /><p>Seçtiğiniz kategoriler ve ürünler burada görünecek.</p></div>}
          <footer>Fiyatlar ürün kataloğundan gelir. Bu görünüm yalnızca düzenleme önizlemesidir; yayın değildir.</footer></div>
          <div className="menu-preview-note"><Eye size={15} />Yayın öncesi görünüm · Buradaki ürünler tıklanamaz</div>
        </aside>
      </div>
    </>}
    {activation && <div className="menu-confirm-backdrop"><section className="card menu-confirm" role="dialog" aria-modal="true" aria-labelledby="menu-confirm-title"><h2 id="menu-confirm-title">{activation.isActive ? "Menü şubede yayından kaldırılsın mı?" : "Menü şubede yayına alınsın mı?"}</h2>
      <p>{activation.isActive ? `“${activation.name}” bu şubenin aktif menüsü olmaktan çıkarılacak. Menü ve ürün kayıtları korunacak.` : `“${activation.name}” bu şubede yayına alınacak.${active ? ` “${active.name}” yayından kaldırılacak.` : ""} QR/web yayını yapılmayacak.`}</p>
      <div><button className="soft-button" disabled={busy || Boolean(pendingRetry)} onClick={() => setActivation(null)}>Vazgeç</button><button className="primary-button" disabled={busy || !canWrite || Boolean(pendingRetry)} onClick={() => {
        const requestId = crypto.randomUUID(); void write(() => provider.activate(scope, activation, requestId), activation.isActive ? "Menü bu şubede yayından kaldırıldı." : "Menü bu şubede yayına alındı.");
      }}>{activation.isActive ? "Yayından kaldır" : "Şubede yayına al"}</button></div></section></div>}
    {pickerSection && <div className="menu-picker-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPickerSectionId(null); }}>
      <section className="menu-picker card" role="dialog" aria-modal="true" aria-labelledby="menu-picker-title">
        <header><div><span className="card-kicker">{pickerSection.name}</span><h2 id="menu-picker-title">Ürün kataloğundan seç</h2><p>Mevcut ürünler menüye eklenir; katalog kartları ve fiyatları değişmez.</p></div><button className="menu-picker-close" aria-label="Ürün seçimini kapat" onClick={() => setPickerSectionId(null)}><X size={19} /></button></header>
        <label className="menu-picker-search"><Search size={17} /><input autoFocus aria-label="Ürün kataloğunda ara" placeholder="Ürün adı ara…" value={pickerQuery} onChange={event => setPickerQuery(event.target.value)} /></label>
        <div className="menu-picker-categories" aria-label="Ürün kategorisi filtresi">
          <button className={pickerCategoryId === "all" ? "selected" : ""} onClick={() => setPickerCategoryId("all")}>Tüm ürünler</button>
          {workspace?.categories.filter(category => category.isActive).map(category => <button key={category.id} className={pickerCategoryId === category.id ? "selected" : ""} onClick={() => setPickerCategoryId(category.id)}>{category.name}</button>)}
        </div>
        <div className="menu-picker-count">{pickerProducts.length} ürün · {pickerSection.productIds.length} menüde seçili</div>
        <div className="menu-picker-grid">{pickerProducts.map(product => {
          const selectedHere = pickerSection.productIds.includes(product.id);
          const unavailable = pickerUsedElsewhere.has(product.id);
          return <button key={product.id} className={`menu-product-card ${selectedHere ? "selected" : ""}`} disabled={!selectedHere && unavailable} aria-pressed={selectedHere} onClick={() => {
            const nextIds = selectedHere ? pickerSection.productIds.filter(id => id !== product.id) : [...pickerSection.productIds, product.id];
            setDraft(current => ({ ...current, sections: current.sections.map(section => section.sectionId === pickerSection.sectionId ? { ...section, productIds: nextIds } : section) }));
          }}><span className="menu-product-card-image" aria-hidden="true">{product.image || "🍽️"}</span><span className="menu-product-card-info"><strong>{product.name}</strong><small>{categoryById.get(product.categoryId)?.name ?? "Ürün"}</small><b>{product.status === "draft" ? "Taslak ürün" : formatCatalogMoney(product.price)}</b></span><span className="menu-product-card-check">{selectedHere ? <Check size={16} /> : unavailable ? "Başka bölümde" : <Plus size={16} />}</span></button>;
        })}{!pickerProducts.length && <div className="menu-picker-empty">Bu filtrede ürün bulunamadı.</div>}</div>
        <footer><span>{pickerSection.productIds.length} ürün seçili</span><button className="primary-button" onClick={() => setPickerSectionId(null)}>Seçimi tamamla</button></footer>
      </section></div>}
  </>;
}
