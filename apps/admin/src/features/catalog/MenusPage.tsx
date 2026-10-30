import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  BookOpen, Check, ChevronDown, ChevronUp, CircleCheck,
  GripVertical, Info, Layers, Package, Pencil, Plus, Search, Trash2, Utensils, X,
} from "lucide-react";
import type { ViewContext } from "../../app/context";
import { PageHeading, StatusPill } from "../../shared/ui";
import { formatCatalogMoney } from "./formatters";
import { ProductImage } from "./ProductImage";
import { HttpMenuProvider, MenuApiError, sampleMenus } from "./MenuProvider";
import type { MenuProduct, MenuSection, MenuWorkspace, RestaurantMenu } from "./MenuProvider";

type Draft = { name: string; description: string; sections: MenuSection[] };
const emptyDraft = (): Draft => ({ name: "", description: "", sections: [] });
const copyDraft = (menu: RestaurantMenu): Draft => ({ name: menu.name, description: menu.description,
  sections: menu.sections.map(section => ({ ...section, productIds: [...section.productIds] })) });

function move<T>(values: T[], from: number, to: number): T[] {
  if (to < 0 || to >= values.length) return values;
  const next = [...values];
  const [value] = next.splice(from, 1);
  next.splice(to, 0, value);
  return next;
}

function ProductStatus({ product }: { product: MenuProduct }) {
  const tone = product.isActive ? "green" : "neutral";
  return <div className="menu-product-statuses" aria-label={`${product.name} ürün durumu`}>
    <StatusPill tone={tone}>{product.isActive ? "Aktif ürün" : "Pasif ürün"}</StatusPill>
  </div>;
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
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [dropTargetSectionId, setDropTargetSectionId] = useState<string | null>(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<(() => Promise<{ id: string }>) | null>(null);
  const alive = useRef(true);
  const requestSerial = useRef(0);
  const provider = useMemo(() => new HttpMenuProvider(), []);
  const scope = useMemo(() => ({ firmId: ctx.firmId, branchId: ctx.branchApiId }), [ctx.firmId, ctx.branchApiId]);
  const selected = workspace?.items.find(menu => menu.id === selectedId);
  const dirty = Boolean(selectedId && !previewOnly && baseline && JSON.stringify(draft) !== baseline);
  const editable = source === "http" && canWrite && !busy && !pendingRetry && !previewOnly;

  const reload = useCallback(async () => {
    const serial = ++requestSerial.current;
    if (!scope.branchId) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = source === "http" ? await provider.load(scope) : sampleMenus(scope);
      if (alive.current && serial === requestSerial.current) setWorkspace(data);
    } catch (reason) {
      if (alive.current && serial === requestSerial.current) setError((reason as Error).message);
    } finally {
      if (alive.current && serial === requestSerial.current) setLoading(false);
    }
  }, [provider, scope, source]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => { alive.current = false; requestSerial.current++; };
  }, [reload]);

  useEffect(() => {
    if (!workspace || selectedId || !workspace.items.length || previewOnly) return;
    const first = workspace.items.find(menu => menu.isActive) ?? workspace.items[0];
    setParams({ menu: first.id }, { replace: true });
  }, [workspace, selectedId, previewOnly, setParams]);

  useEffect(() => {
    if (!workspace) return;
    const next = selected ? copyDraft(selected) : emptyDraft();
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setNewSectionName("");
    setPickerSectionId(null);
    setPickerQuery("");
    setEditingInfo(!selected || selectedId === "new");
  }, [selectedId, workspace, selected]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function open(id: string | null, preview = false) {
    if (busy || pendingRetry || (dirty && !window.confirm("Kaydedilmemiş değişiklikler var. Ayrılmak istiyor musunuz?"))) return;
    setError("");
    setNotice("");
    setParams(id ? { menu: id, ...(preview ? { view: "preview" } : {}) } : {});
  }

  async function write(action: () => Promise<{ id: string }>, message: string) {
    if (!canWrite || busy || source !== "http") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (!alive.current) return;
      setPendingRetry(null);
      setNotice(message);
      setParams({ menu: result.id });
      await reload();
    } catch (reason) {
      if (!alive.current) return;
      const failure = reason as MenuApiError;
      setError(failure.message);
      if (failure.code === "LOAD_FAILED") setPendingRetry(() => action);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function save() {
    const body = { ...draft, requestId: crypto.randomUUID(), expectedVersion: selected?.version ?? 0 };
    void write(() => provider.save(scope, selected?.id ?? null, body), "Menü kaydedildi.");
  }

  function addSection() {
    let name = newSectionName.trim();
    if (!name) {
      name = "Yeni Bölüm";
      let suffix = 2;
      while (draft.sections.some(section => section.name.trim().toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"))) {
        name = `Yeni Bölüm ${suffix++}`;
      }
    }
    if (draft.sections.some(section => section.name.trim().toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"))) {
      setError("Bu menüde aynı başlık zaten var.");
      return;
    }
    setError("");
    setDraft(current => ({ ...current, sections: [...current.sections,
      { sectionId: `custom-${crypto.randomUUID()}`, name, productIds: [] }] }));
    setNewSectionName("");
  }

  const activeMenus = workspace?.items.filter(menu => menu.isActive) ?? [];
  const activeSectionCount = activeMenus.reduce((sum, menu) => sum + menu.sections.length, 0);
  const productById = new Map(workspace?.products.map(product => [product.id, product]));
  const categoryById = new Map(workspace?.categories.map(category => [category.id, category]));
  const selectedProducts = draft.sections.flatMap(section => section.productIds.map(id => productById.get(id)));
  const publishReady = Boolean(draft.sections.length && draft.sections.every(section => section.productIds.length > 0) && selectedProducts.length > 0 &&
    selectedProducts.every(product => product?.isActive && product.status === "published" && product.channels?.includes("pos") && product.price.amountMinor > 0));
  const publishBlocker = !draft.sections.length ? "Önce menüye bölüm ve ürün ekleyin." : draft.sections.some(section => !section.productIds.length)
    ? "Yayına almak için boş menü bölümlerine ürün ekleyin veya boş bölümü kaldırın."
    : selectedProducts.some(product => !product || !product.isActive || product.status !== "published" || !product.channels?.includes("pos") || product.price.amountMinor <= 0)
      ? "POS'ta kullanılabilir menüde yalnızca aktif, POS kanalında yayımlanmış ve geçerli fiyatı olan ürünler bulunabilir." : "";
  const pickerSection = draft.sections.find(section => section.sectionId === pickerSectionId);
  const pickerUsedElsewhere = new Set(draft.sections.filter(section => section.sectionId !== pickerSectionId)
    .flatMap(section => section.productIds));
  const pickerProducts = workspace?.products.filter(product => {
    const matchesCategory = pickerCategoryId === "all" || product.categoryId === pickerCategoryId;
    const text = `${product.name} ${categoryById.get(product.categoryId)?.name ?? ""}`.toLocaleLowerCase("tr-TR");
    return matchesCategory && text.includes(pickerQuery.trim().toLocaleLowerCase("tr-TR"));
  }) ?? [];
  const menuCount = draft.sections.reduce((sum, section) => sum + section.productIds.length, 0);
  const shownMenus = workspace?.items.filter(menu => `${menu.name} ${menu.description}`.toLocaleLowerCase("tr-TR")
    .includes(query.toLocaleLowerCase("tr-TR"))) ?? [];
  const sellableCount = workspace?.products.filter(product => product.isActive && product.status === "published" && product.price.amountMinor > 0).length ?? 0;
  const isNew = selectedId === "new";

  return <>
    <PageHeading eyebrow="ÜRÜNLER VE MENÜ" title="Menüler"
      description="Menülerinizi hazırlayın, ürünlerinizi bölümlerde sıralayın ve şubenizde kullanılacak menüleri yönetin."
      action={<button className="primary-button" disabled={!editable || loading || !workspace} onClick={() => open("new")}>
          <Plus size={17} />Yeni menü
        </button>} />

    <div className="menu-status-banner">
      <div className="menu-status-banner-icon"><BookOpen size={18} /></div>
      <div><strong>{source === "http" ? "Menü Yönetimi" : "Menü örnek gösterimi"}</strong>
        <span>{source === "http" ? "Menü içeriği ve şube seçimi kayıtlı katalog verisiyle çalışır." : "Bu görünüm örnek veridir; yaptığınız değişiklikler kaydedilmez."}</span></div>
    </div>
    {source === "http" && !canWrite && <div className="notice" role="status">
      Menüler salt okunur. Düzenleme için <Link to="/admin/settings/modules">Menü Yönetimi modülünü etkinleştirin</Link>.
    </div>}
    {!scope.branchId && <div className="card generic-empty">Menüleri görmek için bir şube seçin.</div>}
    {error && <div className="notice" role="alert">{error} {pendingRetry
      ? <><span> Sonuç belirsiz; aynı istekle tekrar deneyebilirsiniz.</span><button className="soft-button" disabled={busy || !canWrite}
        onClick={() => void write(pendingRetry, "İstek doğrulandı; menü kaydı güncel.")}>Aynı isteği tekrar dene</button></>
      : <button className="soft-button" disabled={busy} onClick={() => { if (!dirty || window.confirm("Güncel kaydı yüklemek kaydedilmemiş değişiklikleri kaldırır. Devam edilsin mi?")) { setError(""); void reload(); } }}>Güncel kayıtları yükle</button>}
    </div>}
    {notice && <div className="notice menu-success" role="status"><Check size={17} />{notice}</div>}
    {loading && <div className="notice" role="status">Menüler yükleniyor…</div>}

    {workspace && scope.branchId && <>
      <div className="menu-workspace-grid">
        <aside className="menu-sidebar-column" aria-label="Menüler ve şube özeti">
          <section className="menu-saved-panel card">
            <header className="menu-panel-heading"><div><h2>Kayıtlı menüler</h2><span>{workspace.items.length} menü</span></div>
              <label className="menu-search" aria-label="Menülerde ara"><Search size={15} /><input placeholder="Menü ara" value={query}
                onChange={event => setQuery(event.target.value)} /></label></header>
            <div className="menu-saved-list">
              {shownMenus.map(menu => <button type="button" key={menu.id}
                className={`menu-saved-item ${selectedId === menu.id ? "selected" : ""} ${menu.isActive ? "active" : ""}`}
                aria-current={selectedId === menu.id ? "true" : undefined} onClick={() => open(menu.id)}>
                <div className="menu-saved-item-top"><strong>{menu.name}</strong>
                  <StatusPill tone={menu.isActive ? "green" : "neutral"}>{menu.isActive ? "Aktif menü" : "Pasif"}</StatusPill></div>
                <span className="menu-saved-counts">{menu.sections.length} bölüm · {menu.sections.reduce((sum, section) => sum + section.productIds.length, 0)} ürün</span>
                <small>Son güncelleme: {new Date(menu.updatedAt).toLocaleDateString("tr-TR")}</small>
                {selectedId === menu.id && <span className="menu-saved-selected"><CircleCheck size={13} /> Düzenleniyor</span>}
              </button>)}
              {!shownMenus.length && <div className="menu-list-empty">{query ? "Aramayla eşleşen menü yok." : "Henüz menü oluşturulmadı."}</div>}
              {isNew && <div className="menu-saved-item selected menu-new-item"><div className="menu-saved-item-top"><strong>Yeni menü</strong><StatusPill tone="neutral">Taslak</StatusPill></div><span className="menu-saved-counts">{draft.sections.length} bölüm · {menuCount} ürün</span></div>}
            </div>
            <div className="menu-sidebar-summary"><h3>Şube menü özeti</h3><div className="menu-summary-metrics">
              <div><span>Aktif menü</span><strong>{activeMenus.length}</strong></div>
              <div><span>Satışa uygun ürün</span><strong>{sellableCount}</strong></div>
            </div><p>{activeSectionCount} aktif menü bölümü · Menüde gösterilen ürün bilgisi ve fiyatı katalogdan gelir.</p></div>
          </section>
          <div className="menu-sidebar-links"><Link to="/admin/catalog/categories">Kategorileri yönet</Link><Link to="/admin/catalog/products">Ürün kataloğu</Link></div>
        </aside>

        <main className="menu-editor-column" aria-label="Seçili menü düzenleyici">
          {!selectedId && !workspace.items.length && <div className="card menu-editor-empty">
            <BookOpen size={28} /><h2>İlk menünüzü oluşturun</h2><p>Menüye bir ad verin, bölümler ekleyin ve katalogdaki ürünleri yerleştirin.</p>
            <button className="primary-button" disabled={!editable} onClick={() => open("new")}><Plus size={16} />Yeni menü</button>
          </div>}
          {selectedId && selectedId !== "new" && !selected && !loading && <div className="card menu-editor-empty">Bu şubede menü bulunamadı.</div>}
          {(selected || isNew) && <>
            <section className="menu-selected-header card">
              <div className="menu-selected-title-row"><span className="menu-selected-icon"><Utensils size={20} /></span>
                <div className="menu-title-fields">
                  {editingInfo || isNew ? <>
                    <label className="menu-name-field"><span className="sr-only">Menü adı</span><input autoFocus={isNew} value={draft.name} maxLength={160}
                      disabled={!editable} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Menü adı" /></label>
                    <label className="menu-description-field"><span className="sr-only">Menü açıklaması</span><textarea value={draft.description} maxLength={1000}
                      disabled={!editable} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="Menüyü kısaca tanıtın" rows={2} /></label>
                  </> : <><h2>{selected?.name}</h2><p>{selected?.description || "Bu menüye henüz açıklama eklenmedi."}</p></>}
                </div>
                {!editingInfo && !isNew && !previewOnly && <button className="menu-icon-button" aria-label="Menü adı ve açıklamasını düzenle"
                  disabled={!editable} onClick={() => setEditingInfo(true)}><Pencil size={16} /></button>}
                {selected && <StatusPill tone={selected.isActive ? "green" : "neutral"}>{selected.isActive ? "Aktif" : "Pasif"}</StatusPill>}
                {!previewOnly && <button className="primary-button menu-save-button" disabled={!editable || draft.name.trim().length < 2 || (!dirty && Boolean(selected))}
                  onClick={save}><Check size={16} />{busy ? "Kaydediliyor…" : "Değişiklikleri kaydet"}</button>}
                {previewOnly && <button className="soft-button" onClick={() => open(selectedId)}><Pencil size={15} />Düzenlemeye dön</button>}
              </div>
              <div className="menu-selected-subrow"><span><Layers size={14} />{draft.sections.length} bölüm tanımlı</span>
                <span><Package size={14} />{menuCount} ürün</span>
                {dirty && <span className="menu-unsaved" title="Kalıcı olması için Değişiklikleri kaydet düğmesine basın.">Kaydetmediğiniz değişiklikler var</span>}
                {selected && <button type="button" role="switch" aria-checked={selected.isActive}
                  aria-label={`${selected.name} menüsü ${selected.isActive ? "aktif" : "pasif"}. Durumu değiştir`}
                  className={`menu-state-toggle ${selected.isActive ? "is-active" : ""}`}
                  disabled={!editable || dirty || (!selected.isActive && !publishReady)}
                  onClick={() => void write(() => provider.activate(scope, selected, crypto.randomUUID()),
                    selected.isActive ? "Menü pasif duruma alındı." : "Menü aktif duruma alındı.")}
                ><span className="menu-state-toggle-track" aria-hidden="true"><span /></span>
                  <span>{selected.isActive ? "Aktif" : "Pasif"}</span></button>}
              </div>
              {selected?.isActive && <small className="menu-active-note">Bu menü POS’ta kullanılabilir menüler arasında sunulur.</small>}
              {selected && !selected.isActive && !publishReady && <small className="menu-publish-blocker">{publishBlocker}</small>}
            </section>

            <div className="menu-section-toolbar">
              <div><h2>Menü bölümleri</h2><p>Ürünleri bölümlere ekleyin ve sunum sırasını belirleyin.</p></div>
              {!previewOnly && <div className="menu-add-section-controls">
                <input className="menu-section-name-input" aria-label="Özel bölüm adı" maxLength={120}
                  placeholder="Özel bölüm adı (isteğe bağlı)" value={newSectionName} disabled={!editable}
                  onChange={event => setNewSectionName(event.target.value)} />
                <button className="soft-button" disabled={!editable} onClick={addSection}><Plus size={15} />Bölüm ekle</button>
              </div>}
            </div>

            <div className="menu-sections-list">
              {draft.sections.map((section, sectionIndex) => {
                const ordered = section.productIds.map(id => productById.get(id)).filter((product): product is MenuProduct => Boolean(product));
                const changeProducts = (productIds: string[]) => setDraft(current => ({ ...current,
                  sections: current.sections.map((item, index) => index === sectionIndex ? { ...item, productIds } : item) }));
                return <section className={`menu-section-card card ${dropTargetSectionId === section.sectionId ? "drop-target" : ""}`}
                  key={section.sectionId}
                  onDragOver={event => {
                    if (!editable || !draggedSectionId || draggedSectionId === section.sectionId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTargetSectionId(section.sectionId);
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData("text/plain") || draggedSectionId;
                    if (editable && sourceId && sourceId !== section.sectionId) {
                      setDraft(current => {
                        const from = current.sections.findIndex(item => item.sectionId === sourceId);
                        const to = current.sections.findIndex(item => item.sectionId === section.sectionId);
                        return from < 0 || to < 0 ? current : { ...current, sections: move(current.sections, from, to) };
                      });
                    }
                    setDraggedSectionId(null);
                    setDropTargetSectionId(null);
                  }}>
                  <header className="menu-section-heading">
                    <span className={`menu-section-grip ${draggedSectionId === section.sectionId ? "dragging" : ""}`}
                      draggable={editable} role="button" tabIndex={editable ? 0 : -1}
                      aria-label={`${section.name} bölümünü sürükleyerek sırala`}
                      title={editable ? "Bölümü sürükleyerek sırala" : "Sıralamak için düzenleme yetkisi gerekli"}
                      onDragStart={event => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", section.sectionId);
                        setDraggedSectionId(section.sectionId);
                      }}
                      onKeyDown={event => {
                        const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                        if (!editable || !delta) return;
                        event.preventDefault();
                        setDraft(current => ({ ...current, sections: move(current.sections, sectionIndex, sectionIndex + delta) }));
                      }}
                      onDragEnd={() => { setDraggedSectionId(null); setDropTargetSectionId(null); }}><GripVertical size={16} /></span>
                    <span className="menu-section-number">{sectionIndex + 1}</span>
                    <label><span className="sr-only">{section.name} menü bölüm adı</span><input value={section.name} maxLength={120} disabled={!editable}
                      onChange={event => setDraft(current => ({ ...current, sections: current.sections.map((item, index) => index === sectionIndex
                        ? { ...item, name: event.target.value } : item) }))} /></label>
                    <span className="menu-section-product-count">{section.productIds.length} ürün</span>
                    <div className="menu-section-actions">
                      {!previewOnly && <button className="text-action-button" disabled={!editable} onClick={() => {
                        setPickerSectionId(section.sectionId);
                        const category = workspace.categories.find(item => `catalog-${item.id}` === section.sectionId);
                        setPickerCategoryId(category?.id ?? "all"); setPickerQuery("");
                      }}><Plus size={15} />Ürün ekle</button>}
                      <button className="menu-icon-button" aria-label={`${section.name} bölümünü yukarı taşı`} disabled={!editable || sectionIndex === 0}
                        onClick={() => setDraft(current => ({ ...current, sections: move(current.sections, sectionIndex, sectionIndex - 1) }))}><ChevronUp size={16} /></button>
                      <button className="menu-icon-button" aria-label={`${section.name} bölümünü aşağı taşı`} disabled={!editable || sectionIndex === draft.sections.length - 1}
                        onClick={() => setDraft(current => ({ ...current, sections: move(current.sections, sectionIndex, sectionIndex + 1) }))}><ChevronDown size={16} /></button>
                      <button className="menu-icon-button danger" aria-label={`${section.name} bölümünü kaldır`} disabled={!editable}
                        onClick={() => setDraft(current => ({ ...current, sections: current.sections.filter((_, index) => index !== sectionIndex) }))}><Trash2 size={15} /></button>
                    </div>
                  </header>
                  {ordered.length ? <div className="menu-section-products">{ordered.map(product => <div className="menu-real-product-row" key={product.id}>
                    <span className="menu-real-product-icon" aria-hidden="true"><ProductImage image={product.image} productId={product.id} firmId={ctx.firmId} branchId={ctx.branchApiId} actor={ctx.isMulti ? "manager-multi" : "manager-single"} name={product.name} /></span>
                    <div className="menu-real-product-copy"><strong>{product.name}</strong><small>{categoryById.get(product.categoryId)?.name ?? "Kategorisiz ürün"}</small></div>
                    <div className="menu-real-product-price">{formatCatalogMoney(product.price)}</div>
                    <ProductStatus product={product} />
                    {!previewOnly && <div className="menu-product-row-actions">
                      <button className="menu-icon-button" aria-label={`${product.name} ürününü yukarı taşı`} disabled={!editable || section.productIds.indexOf(product.id) === 0}
                        onClick={() => changeProducts(move(section.productIds, section.productIds.indexOf(product.id), section.productIds.indexOf(product.id) - 1))}><ChevronUp size={15} /></button>
                      <button className="menu-icon-button" aria-label={`${product.name} ürününü aşağı taşı`} disabled={!editable || section.productIds.indexOf(product.id) === section.productIds.length - 1}
                        onClick={() => changeProducts(move(section.productIds, section.productIds.indexOf(product.id), section.productIds.indexOf(product.id) + 1))}><ChevronDown size={15} /></button>
                      <button className="menu-icon-button danger" aria-label={`${product.name} ürününü bölümden çıkar`} disabled={!editable}
                        onClick={() => changeProducts(section.productIds.filter(id => id !== product.id))}><X size={15} /></button>
                    </div>}
                  </div>)}</div> : <div className="menu-section-empty"><Package size={17} />Bu bölümde ürün yok.{!previewOnly && <span>Ürün ekleyerek menü içeriğini hazırlayın.</span>}</div>}
                  {!previewOnly && !ordered.length && <button className="menu-empty-add-product" disabled={!editable} onClick={() => {
                    setPickerSectionId(section.sectionId); setPickerCategoryId("all"); setPickerQuery("");
                  }}><Plus size={15} />Ürün ekle</button>}
                </section>;
              })}
              {!draft.sections.length && <div className="menu-no-sections card"><Layers size={23} /><strong>Henüz bölüm yok</strong>
                <span>Menüye bir bölüm ekleyin, ardından ürünleri bu bölümde sıralayın.</span></div>}
              {!previewOnly && <button className="menu-add-section-tile" disabled={!editable} onClick={() => document.querySelector<HTMLInputElement>("input[aria-label='Özel bölüm adı']")?.focus()}>
                <span><Plus size={18} /></span><strong>Yeni bölüm ekle</strong><small>Menünüze yeni bir sunum grubu ekleyin.</small>
              </button>}
            </div>
            <div className="menu-catalog-hint"><Info size={16} /><span><strong>İpucu:</strong> Kategoriler ürün kataloğundan yönetilir. Menü bölümleri yalnızca bu menünün sunum ve sıralama yapısını belirler.</span></div>
          </>}
        </main>
      </div>
    </>}

    {pickerSection && <div className="menu-picker-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) setPickerSectionId(null);
    }}><section className="menu-picker card" role="dialog" aria-modal="true" aria-labelledby="menu-picker-title">
      <header><div><span className="card-kicker">{pickerSection.name}</span><h2 id="menu-picker-title">Katalogdan ürün ekle</h2>
        <p>Ürünler katalogdan kullanılır; bu işlem ürün kartını değiştirmez.</p></div>
        <button className="menu-picker-close" aria-label="Ürün seçimini kapat" onClick={() => setPickerSectionId(null)}><X size={19} /></button></header>
      <label className="menu-picker-search"><Search size={17} /><input autoFocus aria-label="Ürün kataloğunda ara" placeholder="Ürün adı ara…" value={pickerQuery}
        onChange={event => setPickerQuery(event.target.value)} /></label>
      <div className="menu-picker-categories" aria-label="Ürün kategorisi filtresi">
        <button className={pickerCategoryId === "all" ? "selected" : ""} onClick={() => setPickerCategoryId("all")}>Tüm ürünler</button>
        {workspace?.categories.filter(category => category.isActive).map(category => <button key={category.id}
          className={pickerCategoryId === category.id ? "selected" : ""} onClick={() => setPickerCategoryId(category.id)}>{category.name}</button>)}
      </div>
      <div className="menu-picker-count">{pickerProducts.length} ürün · {pickerSection.productIds.length} bu bölümde</div>
      <div className="menu-picker-grid">{pickerProducts.map(product => {
        const selectedHere = pickerSection.productIds.includes(product.id);
        const unavailable = pickerUsedElsewhere.has(product.id);
        const inactive = !product.isActive || product.status !== "published" || !product.channels?.includes("pos");
        return <button key={product.id} className={`menu-product-card ${selectedHere ? "selected" : ""}`}
          disabled={!selectedHere && (unavailable || inactive)} aria-pressed={selectedHere} onClick={() => {
            const nextIds = selectedHere ? pickerSection.productIds.filter(id => id !== product.id) : [...pickerSection.productIds, product.id];
            setDraft(current => ({ ...current, sections: current.sections.map(section => section.sectionId === pickerSection.sectionId
              ? { ...section, productIds: nextIds } : section) }));
          }}><span className="menu-product-card-image" aria-hidden="true"><ProductImage image={product.image} productId={product.id} firmId={ctx.firmId} branchId={ctx.branchApiId} actor={ctx.isMulti ? "manager-multi" : "manager-single"} name={product.name} /></span>
          <span className="menu-product-card-info"><strong>{product.name}</strong><small>{categoryById.get(product.categoryId)?.name ?? "Kategorisiz"}</small>
            <b>{formatCatalogMoney(product.price)}</b><span className="menu-picker-status">{product.isActive ? "Aktif ürün" : "Pasif ürün"}</span></span>
          <span className="menu-product-card-check">{selectedHere ? <Check size={15} /> : unavailable ? "Başka bölümde" : inactive ? "Kullanılamaz" : <Plus size={16} />}</span>
        </button>;
      })}{!pickerProducts.length && <div className="menu-picker-empty">Bu filtrede ürün bulunamadı.</div>}</div>
      <footer><span>{pickerSection.productIds.length} ürün seçili</span><button className="primary-button" onClick={() => setPickerSectionId(null)}>Seçimi tamamla</button></footer>
    </section></div>}
  </>;
}
