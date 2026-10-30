import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Filter,
  Info,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { ViewContext } from "../../app/context";
import { useCatalogProvider } from "../../app/providers";
import { StatusPill, PageHeading, DemoNotice } from "../../shared/ui";
import { channelLabels, formatCatalogMoney } from "./formatters";
import { useCategoryList, useProductDetail, useProductList } from "./useCatalogData";
import { DraftForm } from "./DraftForm";
import { PricePublicationPanel } from "./PricePublicationPanel";
import { ProductOptionsPanel } from "./ProductOptionsPanel";
import { ProductImage } from "./ProductImage";
import type { CatalogLoad } from "./useCatalogData";
import type { CategoryListResponse, ProductListResponse } from "./contracts";
import singleDemo from "../../../../../contracts/demo-single-branch.v1.json";

const statusLabel = { published: "Yayında", draft: "Satışa açılmadı" } as const;
type InventoryRecipeDetail = { id: string; productId: string; productName: string; version: number; portion: string;
  lines: Array<{ ingredientId: string; ingredientName: string; quantity: number; unit: string }> };

function makeCategoryId(name: string, existingIds: string[]) {
  const base = name.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "kategori";
  const used = new Set(existingIds);
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function CatalogStatePanel<T>({
  load,
}: {
  load: CatalogLoad<T>;
}) {
  if (load.status === "loading") {
    return (
      <div className="card empty-list" role="status">
        <strong>Ürün verileri yükleniyor</strong>
        <span>Seçili kapsam hazırlanıyor.</span>
      </div>
    );
  }
  if (load.status === "error") {
    const { code, message } = load.error;
    const title =
      code === "UNAUTHORIZED_SCOPE"
        ? "Bu kapsama erişim yok"
        : code === "CATALOG_STORAGE_UNAVAILABLE"
          ? "Katalog veritabanı hazır değil"
        : code === "FEATURE_DISABLED"
          ? "Modül kapalı"
          : code === "FEATURE_SETUP_REQUIRED"
            ? "Kurulum gerekiyor"
            : code === "PROVIDER_PENDING"
              ? "Sağlayıcı bekleniyor"
              : code === "PRODUCT_NOT_FOUND"
                ? "Ürün bulunamadı"
                : "Veri yüklenemedi";
    return (
      <div className="card empty-list" role="alert">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
    );
  }
  return null;
}

export function CategoriesPage({ ctx, canWriteDraft }: { ctx: ViewContext; canWriteDraft: boolean }) {
  const { provider, source, notifyChange } = useCatalogProvider();
  const [searchParams] = useSearchParams();
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useCategoryList(scope);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; category: CategoryListResponse["items"][number] } | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const categories = load.status === "success" ? load.data.items : [];
  const filteredCategories = categories.filter(category => category.name
    .toLocaleLowerCase("tr-TR").includes(query.trim().toLocaleLowerCase("tr-TR")));
  const canEdit = source === "http" && Boolean(ctx.branchApiId);
  const selectedBranchName = ctx.selectedBranch?.name;
  function productsUrl(categoryId: string, create = false) {
    const params = new URLSearchParams();
    for (const key of ["catalogState", "featureState"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    params.set("categoryId", categoryId);
    params.set("categoryFirm", ctx.firmId);
    params.set("categoryBranch", ctx.branchApiId ?? "all");
    if (create) params.set("createProduct", "1");
    return `/admin/catalog/products?${params}`;
  }

  function openCreate() {
    setDialog({ kind: "create" });
    setCategoryName("");
    setFormError("");
    setNotice("");
  }

  function openEdit(category: CategoryListResponse["items"][number]) {
    setDialog({ kind: "edit", category });
    setCategoryName(category.name);
    setFormError("");
    setNotice("");
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || !canEdit || saving) return;
    const name = categoryName.trim();
    if (!name) return;
    setSaving(true);
    setFormError("");
    try {
      if (dialog.kind === "edit") {
        const version = dialog.category.version;
        if (version === undefined) throw new Error("Kategori sürümü alınamadı. Güncel kayıtları yükleyip tekrar deneyin.");
        await provider.renameCategory({ scope, categoryId: dialog.category.id, name, expectedVersion: version });
        setNotice(`“${dialog.category.name}” kategori adı güncellendi.`);
      } else {
        const id = makeCategoryId(name, categories.map(category => category.id));
        await provider.createCategory({ scope, id, name });
        setNotice("Kategori oluşturuldu.");
      }
      setDialog(null);
      notifyChange();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Kategori kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <PageHeading eyebrow="ÜRÜNLER VE MENÜ" title="Kategoriler"
      description={selectedBranchName
        ? `${selectedBranchName} şubesinin kategorilerini görüntüleyin ve yönetin.`
        : "Kategorileri görüntülemek ve yönetmek için önce bir şube seçin."}
      action={<button className="primary-button" disabled={!canEdit || load.status !== "success"} onClick={openCreate}
        title={!ctx.branchApiId ? "Önce bir şube seçin" : canEdit ? "Yeni kategori oluştur" : "Örnek veride kategori kaydedilemez."}><Plus size={17} />Yeni kategori</button>} />
    <div className="category-info-banner"><Info size={17} /><span>Menü bölümleri kategorilerden ayrıdır. Bir kategori ürünleri katalogda gruplar; menü bölümlerini menü ekranında düzenlersiniz.</span></div>
    {notice && <div className="notice menu-success" role="status"><Check size={16} />{notice}</div>}
    {!ctx.branchApiId ? <section className="card category-list-empty"><Tag size={23} /><strong>Şube seçin</strong>
      <span>Kategori listesi, üst menüden seçtiğiniz şubeye göre gösterilir.</span></section> :
    load.status !== "success" ? <CatalogStatePanel load={load} /> :
      <section className="card category-list-card" aria-label="Kategoriler listesi">
        <header className="category-list-toolbar">
          <label className="category-search"><Search size={17} /><input aria-label="Kategori ara" placeholder="Kategori ara..." value={query}
            onChange={event => setQuery(event.target.value)} /></label>
          <div className="category-list-summary"><span className="category-total"><Tag size={16} />Toplam {categories.length} kategori</span>
            <span className="category-summary-scope">{selectedBranchName}</span></div>
        </header>
        <div className="category-list-rows">
          {filteredCategories.map(category => <article className="category-list-row" key={category.id}>
            <span className="category-row-icon"><Tag size={18} /></span>
            <div className="category-row-main"><strong>{category.name}</strong></div>
            <span className={`category-product-count ${category.productCount ? "has-products" : "empty"}`}>
              {category.productCount} ürün
            </span>
            <div className="category-row-actions">
              <Link className="soft-button" to={productsUrl(category.id)} aria-label={`${category.name} ürünlerini gör`}>Ürünleri gör</Link>
              {canWriteDraft ? <Link className="soft-button" to={productsUrl(category.id, true)} aria-label={`${category.name} kategorisine ürün ekle`}><Plus size={15} />Ürün ekle</Link>
                : <button className="soft-button" disabled title="Ürün eklemek için ürün ve fiyat özellikleri bu şubede hazır olmalı."><Plus size={15} />Ürün ekle</button>}
              <button className="soft-button category-edit-button" disabled={!canEdit} title={canEdit ? "Kategori adını düzenle" : "Örnek veride kategori düzenlenemez."}
                onClick={() => openEdit(category)}><Pencil size={15} />Düzenle</button>
            </div>
          </article>)}
          {!filteredCategories.length && <div className="category-list-empty">
            <Tag size={23} /><strong>{query ? "Eşleşen kategori bulunamadı" : "Henüz kategori yok"}</strong>
            <span>{query ? "Arama sözcüğünü değiştirip tekrar deneyin." : "İlk kategorinizi oluşturarak ürünlerinizi düzenlemeye başlayın."}</span>
            {!query && <button className="primary-button" disabled={!canEdit} onClick={openCreate}><Plus size={16} />İlk kategoriyi oluştur</button>}
          </div>}
        </div>
        <footer className="category-scope-note"><Info size={16} /><span><strong>{selectedBranchName}:</strong> Bu listedeki kategoriler yalnızca seçili şube için geçerlidir. Ürün sayıları aynı şubedeki ürünleri gösterir.</span></footer>
      </section>}
    {dialog && <div className="category-dialog-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !saving) setDialog(null);
    }}><section className="category-dialog card" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title">
      <header><div><span className="eyebrow">ÜRÜNLER VE MENÜ</span><h2 id="category-dialog-title">{dialog.kind === "create" ? "Yeni kategori" : "Kategori adını düzenle"}</h2></div>
        <button className="menu-picker-close" aria-label="Pencereyi kapat" disabled={saving} onClick={() => setDialog(null)}><X size={18} /></button></header>
      <p>{dialog.kind === "create"
        ? `${selectedBranchName} şubesi için yeni bir kategori oluşturuyorsunuz.`
        : `Kategori adı yalnızca ${selectedBranchName} şubesindeki ilgili ürünlere yansıtılır.`}</p>
      <form onSubmit={event => void submitCategory(event)}>
        <label className="category-name-field">Kategori adı<input autoFocus value={categoryName} maxLength={160} disabled={saving}
          onChange={event => setCategoryName(event.target.value)} placeholder="Örn. Sıcak İçecekler" /></label>
        {formError && <div className="category-form-error" role="alert"><AlertCircle size={16} />{formError}</div>}
        <footer><button type="button" className="soft-button" disabled={saving} onClick={() => setDialog(null)}>Vazgeç</button>
          <button type="submit" className="primary-button" disabled={saving || !categoryName.trim()}>
            {saving ? "Kaydediliyor…" : dialog.kind === "create" ? "Kategori oluştur" : "Değişiklikleri kaydet"}</button></footer>
      </form>
    </section></div>}
  </>;
}

export function ProductsPage({ ctx, canPreviewNewWork, canWriteDraft, canSetPrice }: { ctx: ViewContext; canPreviewNewWork: boolean; canWriteDraft: boolean; canSetPrice: boolean }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [categoryCache, setCategoryCache] = useState<{
    firmId: string;
    branchId: string | null;
    items: ProductListResponse["categories"];
  } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const scopeKey = `${ctx.firmId}:${ctx.branchApiId ?? "all"}`;
  const previousScope = useRef(scopeKey);
  const category = searchParams.get("categoryFirm") === ctx.firmId &&
    searchParams.get("categoryBranch") === (ctx.branchApiId ?? "all")
    ? searchParams.get("categoryId") ?? "" : "";
  const requestedCreate = Boolean(category && ctx.branchApiId && searchParams.get("createProduct") === "1");
  function setCategory(value: string) {
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set("categoryId", value);
      next.set("categoryFirm", ctx.firmId);
      next.set("categoryBranch", ctx.branchApiId ?? "all");
    } else {
      next.delete("categoryId"); next.delete("categoryFirm"); next.delete("categoryBranch");
    }
    next.delete("createProduct");
    setSearchParams(next);
  }
  function closeCreate() {
    setCreating(false);
    if (searchParams.has("createProduct")) {
      const next = new URLSearchParams(searchParams);
      next.delete("createProduct");
      setSearchParams(next, { replace: true });
    }
  }
  const { mode, source, notifyChange } = useCatalogProvider();
  const [creating, setCreating] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    setCreating(false); setSaveNotice(""); setCategoryCache(null); setPage(1);
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      for (const key of ["categoryId", "categoryFirm", "categoryBranch", "createProduct"]) next.delete(key);
      return next;
    }, { replace: true });
  }, [scopeKey, setSearchParams]);
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useProductList(scope, query, category || undefined, page);
  const products = load.status === "success" ? load.data.items : [];
  useEffect(() => { setPage(1); }, [category]);
  useEffect(() => {
    if (load.status === "success")
      setCategoryCache({ firmId: ctx.firmId, branchId: ctx.branchApiId, items: load.data.categories });
  }, [load, ctx.firmId, ctx.branchApiId]);
  useEffect(() => {
    if (load.status === "success" && page > Math.max(1, load.data.pageInfo.totalPages))
      setPage(Math.max(1, load.data.pageInfo.totalPages));
  }, [load, page]);
  const categories = load.status === "success" ? load.data.categories
    : categoryCache?.firmId === ctx.firmId && categoryCache.branchId === ctx.branchApiId ? categoryCache.items : [];
  const detailParams = new URLSearchParams(searchParams);
  detailParams.delete("createProduct");
  const detailSuffix = detailParams.toString()
    ? `?${detailParams.toString()}`
    : "";
  const changePreviewMode = (value: string) => {
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (value === "normal") next.delete("catalogState");
    else next.set("catalogState", value);
    setSearchParams(next);
  };
  return (
    <>
      <PageHeading
        eyebrow="ÜRÜNLER VE MENÜ"
        title="Ürünler"
        description="Menünüzdeki ürünleri, fiyatları ve kanal görünürlüğünü tek yerden inceleyin."
        action={
          source === "http" ? <button className="primary-button" disabled={!canWriteDraft}
            title={canWriteDraft ? "Yeni ürün oluştur" : "Şube seçimi ve ürün yönetimi hazır olmalı"}
            onClick={() => { setSaveNotice(""); setCreating(true); }}>
            <Plus size={17} /> Yeni ürün
          </button> : <button
            className="primary-button"
            disabled={!canPreviewNewWork}
            title={canPreviewNewWork ? "Yalnız prototip akışı" : "Önce bir şube seçin ve özellik hazır durumda olsun"}
            onClick={() =>
              document
                .getElementById("prototype-product-notice")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <Plus size={17} /> Ürün ekleme akışı
          </button>
        }
      />
      {source === "mock" && <DemoNotice>Ürünler örnek veridir; bu görünümde kayıt yapılamaz.</DemoNotice>}
      {source === "http" && !canWriteDraft && <div className="notice" role="status">
        Ürün eklemek için bir şube seçin ve ürün özelliğini etkinleştirin. <Link to="/admin/settings/modules">Modül ayarları</Link>
      </div>}
      {saveNotice && <div className="notice" role="status">{saveNotice}</div>}
      {(creating || requestedCreate) && source === "http" && canWriteDraft && <DraftForm key={`${ctx.firmId}:${ctx.branchApiId}`} scope={scope} initialCategoryId={category || undefined} canSetPrice={canSetPrice}
        onCancel={() => { closeCreate(); notifyChange(); }} onSaved={(saved) => {
          setCreating(false); notifyChange(); navigate(`/admin/catalog/products/${encodeURIComponent(saved.id)}?created=1`);
        }} />}
      {source === "mock" && <div className="scope-bar" style={{ marginBottom: 18 }}>
        <div className="scope-bar-left">
          <span className="scope-label">Durum önizlemesi</span>
          <select
            aria-label="Katalog durum önizlemesi"
            value={mode}
            onChange={(event) => changePreviewMode(event.target.value)}
          >
            <option value="normal">Normal</option>
            <option value="empty">Boş liste</option>
            <option value="error">Hata</option>
            <option value="unauthorized">Yetkisiz</option>
            <option value="disabled">Modül kapalı</option>
            <option value="setup_required">Kurulum gerekiyor</option>
            <option value="provider_pending">Sağlayıcı bekleniyor</option>
          </select>
        </div>
        <span className="scope-hint">Yalnız tasarım senaryosu · gerçek API yanıtı değil</span>
      </div>}
      <div className="card content-card">
        <div className="tabs">
          <button
            className={category === "" ? "selected" : ""}
            onClick={() => setCategory("")}
          >
            Tüm ürünler{" "}
            {!category && !query && <span>
              {load.status === "success" ? load.data.pageInfo.totalItems : "—"}
            </span>}
          </button>
          {categories.map((item) => (
            <button key={item.id} className={category === item.id ? "selected" : ""}
              onClick={() => setCategory(item.id)}>{item.name}</button>
          ))}
        </div>
        <div className="table-toolbar">
          <button
            className={`soft-button ${filtersOpen ? "selected-filter" : ""}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Filter size={16} /> Filtreler <ChevronDown size={15} />
          </button>
          <div className="table-search">
            <Search size={17} />
            <input
              aria-label="Ürün ara"
              placeholder="Ürün adı veya stok koduyla ara..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            />
          </div>
        </div>
        {filtersOpen && (
          <div className="filter-panel">
            <span>Kategori</span>
            <select
              aria-label="Kategori filtresi"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Tümü</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="link-button"
              onClick={() => {
                setCategory("");
                setQuery("");
              }}
            >
              Filtreleri temizle
            </button>
          </div>
        )}
        {load.status !== "success" && <CatalogStatePanel load={load} />}
        {load.status === "success" && (
          <>
            <div className="table-scroll">
              <table className="products-table">
                <thead>
                  <tr>
                    <th>ÜRÜN</th>
                    <th>KATEGORİ</th>
                    <th>KANALLAR</th>
                    <th>ÜRÜN DURUMU</th>
                    <th>YAYIN DURUMU</th>
                    <th>{ctx.branchApiId ? "ŞUBE FİYATI" : "MERKEZ FİYATI"}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="product-cell">
                          <div className="food-thumb"><ProductImage image={product.image} productId={product.id} firmId={ctx.firmId} branchId={ctx.branchApiId ?? (product.branchIds.length === 1 ? product.branchIds[0] : null)} actor={ctx.isMulti ? "manager-multi" : "manager-single"} name={product.name} /></div>
                          <div>
                            <Link
                              to={`/admin/catalog/products/${product.id}${detailSuffix}`}
                              className="product-link"
                            >
                              {product.name}
                            </Link>
                            <small>Stok kodu: {product.sku}</small>
                          </div>
                        </div>
                      </td>
                      <td>{product.category.name}</td>
                      <td>
                        <div className="channel-list">
                          {product.channels.map((channel) => (
                            <span key={channel}>{channelLabels[channel]}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <StatusPill tone={product.isActive ? "green" : "red"}>
                          {product.isActive ? "Aktif" : "Pasif"}
                        </StatusPill>
                      </td>
                      <td>
                        <StatusPill
                          tone={
                            product.status === "published" ? "green" : "orange"
                          }
                        >
                          {statusLabel[product.status]}
                        </StatusPill>
                      </td>
                      <td className="numeric strong">
                        {product.price.amountMinor > 0 ? formatCatalogMoney(product.price) : "Fiyat belirlenmedi"}
                      </td>
                      <td>
                        <Link
                          aria-label={`${product.name} ayrıntısı`}
                          to={`/admin/catalog/products/${product.id}${detailSuffix}`}
                          className="row-arrow"
                        >
                          <ArrowRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {products.length === 0 && (
                <div className="empty-list">
                  <Search size={25} />
                  <strong>
                    {query || category ? "Sonuç bulunamadı" : "Henüz ürün yok"}
                  </strong>
                  <span>
                    {query || category
                      ? "Arama veya filtreleri değiştirmeyi deneyin."
                      : "Bu kapsamda gösterilecek ürün bulunmuyor."}
                  </span>
                </div>
              )}
            </div>
            <div className="table-footer">
              <span>{products.length}{load.data.pageInfo.totalItems > products.length ? ` / ${load.data.pageInfo.totalItems}` : ""} ürün gösteriliyor</span>
              <div className="catalog-pagination">
                <button className="soft-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</button>
                <span>
                {source === "http" ? "Ürün kataloğu" : "Örnek menü"} · sayfa {load.data.pageInfo.page} /{" "}
                {Math.max(1, load.data.pageInfo.totalPages)}
                </span>
                <button className="soft-button" disabled={page >= load.data.pageInfo.totalPages} onClick={() => setPage(page + 1)}>Sonraki</button>
              </div>
            </div>
          </>
        )}
      </div>
      {source === "mock" && <div id="prototype-product-notice" className="prototype-box">
        <div className="prototype-icon">
          <Sparkles size={20} />
        </div>
        <div>
          <strong>Ürün ekleme akışı tasarlanıyor</strong>
          <p>
            Bu aşamada yeni ürün kaydı oluşturulmaz. Gelecek form; kategori,
            seçenek grubu, fiyat, reçete ve kanal görünürlüğünü
            kapsayacak.
          </p>
        </div>
        <StatusPill tone="purple">Prototip</StatusPill>
      </div>}
    </>
  );
}

export function ProductDetail({
  ctx,
  productId,
  canWriteDraft,
  canSetPrice,
  canPublish,
  inventorySource,
}: {
  ctx: ViewContext;
  productId: string;
  canWriteDraft: boolean;
  canSetPrice: boolean;
  canPublish: boolean;
  inventorySource: "mock" | "http";
}) {
  const { source, provider, notifyChange } = useCatalogProvider();
  const [searchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const imageRequest = useRef<{ file: File; version: number; id: string } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [activationRequestId, setActivationRequestId] = useState(() => crypto.randomUUID());
  const [recipeState, setRecipeState] = useState<{ status: "loading" } | { status: "loaded"; recipe: InventoryRecipeDetail | null } | { status: "error"; message: string }>({ status: "loading" });
  useEffect(() => { setEditing(false); setSaveNotice(""); setActivationRequestId(crypto.randomUUID()); setImageFile(null); setImageError(""); imageRequest.current = null; if (imageInput.current) imageInput.current.value = ""; }, [ctx.firmId, ctx.branchApiId, productId]);
  useEffect(() => {
    if (inventorySource !== "http" || !ctx.branchApiId) { setRecipeState({ status: "loaded", recipe: null }); return; }
    let cancelled = false;
    setRecipeState({ status: "loading" });
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    const actor = ctx.isMulti ? "manager-multi" : "manager-single";
    void fetch(`${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/inventory/recipes/${encodeURIComponent(productId)}`, {
      headers: { "X-Demo-Actor": actor },
    }).then(async (response) => {
      if (response.status === 404) return null;
      if (!response.ok) {
        const problem = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(problem.detail ?? `Reçete API'si yanıt vermedi (${response.status}).`);
      }
      return response.json() as Promise<InventoryRecipeDetail>;
    }).then((recipe) => { if (!cancelled) setRecipeState({ status: "loaded", recipe }); })
      .catch((reason) => { if (!cancelled) setRecipeState({ status: "error", message: (reason as Error).message }); });
    return () => { cancelled = true; };
  }, [ctx.branchApiId, ctx.firmId, ctx.isMulti, inventorySource, productId]);
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useProductDetail(scope, productId);
  if (load.status !== "success") {
    return (
      <>
        <Link to="/admin/catalog/products" className="back-link">
          <ArrowLeft size={16} /> Ürünler
        </Link>
        <CatalogStatePanel load={load} />
      </>
    );
  }
  const product = load.data;
  const demoRecipe = ctx.scenarioId === "single"
    ? singleDemo.recipes.find((recipe) => recipe.productId === product.id)
    : undefined;
  return (
    <div className="catalog-detail-page">
      <Link to="/admin/catalog/products" className="back-link">
        <ArrowLeft size={16} /> Ürünler
      </Link>
      <PageHeading
        eyebrow={source === "http" ? "ÜRÜN AYRINTISI" : "ÜRÜN AYRINTISI · ÖRNEK VERİ"}
        title={product.name}
        description={`Stok kodu: ${product.sku} · ${product.category.name}`}
        action={source === "http" ? <div className="catalog-product-actions">
          <StatusPill tone={product.isActive ? "green" : "red"}>{product.isActive ? "Ürün aktif" : "Ürün pasif"}</StatusPill>
          <button className="primary-button" disabled={!canWriteDraft || (product.status === "published" && (!canPublish || product.branchIds.length !== 1))}
            title={product.status === "published" && product.branchIds.length !== 1 ? "Birden fazla şubedeki ürün bu ekrandan düzenlenemez." : undefined}
            onClick={() => { setSaveNotice(""); setEditing(true); }}>Ürünü düzenle</button>
          {product.status === "published" && <StatusPill tone={product.channels.includes("pos") ? "green" : "neutral"}>{product.channels.includes("pos") ? "POS kanalında yayın kaydı var" : "POS'ta yayınlanmadı"}</StatusPill>}
          <button className="soft-button" disabled={!canWriteDraft || activationBusy} onClick={() => void (async () => {
            const nextActive = !product.isActive;
            if (!window.confirm(nextActive
              ? `“${product.name}” ürününü yeniden etkinleştirelim mi? Yeni işlemlerde fiyat ve POS yayın kuralları yine uygulanacak.`
              : `“${product.name}” pasife alınsın mı? Yeni sipariş ve yayınlarda kullanılamaz; açık adisyonlar ve geçmiş kayıtlar korunur.`)) return;
            setActivationBusy(true); setActivationError(""); setSaveNotice("");
            try {
              await provider.setProductActive({ scope, productId: product.id, requestId: activationRequestId,
                expectedVersion: product.version, isActive: nextActive });
              setActivationRequestId(crypto.randomUUID());
              notifyChange();
              setSaveNotice(nextActive ? "Ürün etkinleştirildi; kayıt veritabanında doğrulandı." : "Ürün pasife alındı. Açık adisyonlar ve geçmiş kayıtlar korunuyor.");
            } catch (reason) { setActivationError(reason instanceof Error ? reason.message : "Ürün durumu değiştirilemedi."); }
            finally { setActivationBusy(false); }
          })()}>{activationBusy ? "Güncelleniyor…" : product.isActive ? "Ürünü pasife al" : "Ürünü etkinleştir"}</button>
        </div> : <StatusPill tone="purple">Önizleme</StatusPill>}
      />
      {source === "http" && product.status === "draft" && !canWriteDraft && <div className="notice" role="status">
        Ürün bilgilerini değiştirmek için ürün özelliği bu şubede hazır olmalı. <Link to="/admin/settings/modules">Modül ayarları</Link>
      </div>}
      {source === "http" && product.status === "published" && (!canWriteDraft || !canPublish) && <div className="notice" role="status">
        Yayımlanmış ürünü düzenlemek için ürün ve POS yayını özellikleri bu şubede hazır olmalı. <Link to="/admin/settings/modules">Modül ayarları</Link>
      </div>}
      {source === "http" && product.status === "published" && product.branchIds.length !== 1 && <div className="notice" role="status">
        Birden fazla şubede kullanılan ürünün bilgileri bu ekrandan düzenlenemez.
      </div>}
      {saveNotice && <div className="notice" role="status">{saveNotice}</div>}
      {searchParams.get("created") === "1" && !saveNotice && <div className="notice" role="status">Ürün ve fiyat kaydedildi. Satışa açmak için aşağıdaki POS'a yayınla düğmesini kullanın.</div>}
      {activationError && <div className="notice" role="alert">{activationError}</div>}
      {source === "http" && !product.isActive && <div className="notice" role="status">Ürün pasif. Yeni siparişe eklenemez ve yeni menü/POS yayınına alınamaz. Açık adisyonlar, mevcut yayın geçmişi ve ürün kaydı korunur.</div>}
      {editing && source === "http" && canWriteDraft && <DraftForm key={`${ctx.firmId}:${ctx.branchApiId}:${product.id}:${product.version}`}
        scope={scope} product={product} onCancel={() => { setEditing(false); notifyChange(); }}
        onSaved={() => { setEditing(false); notifyChange(); setSaveNotice("Ürün bilgileri kaydedildi."); }} />}
      <div className="detail-grid">
        <div className="detail-main">
          <section className="card detail-card">
            <div className="detail-card-head">
              <div className="detail-hero-icon"><ProductImage image={product.image} productId={product.id} firmId={ctx.firmId} branchId={ctx.branchApiId} actor={ctx.isMulti ? "manager-multi" : "manager-single"} name={product.name} /></div>
              <div>
                <span className="card-kicker">TEMEL BİLGİLER</span>
                <h2>{product.name}</h2>
                <p>{product.description || "Açıklama eklenmemiş."}</p>
              </div>
            </div>
            {source === "http" && ctx.branchApiId && <section className="product-image-upload" aria-label="Ürün görseli"><strong>Ürün görseli</strong><p>Bilgisayarınızdan JPEG, PNG veya WebP seçin (en fazla 2 MB). Görsel, ürün ve menü ekranlarında gösterilir.</p><label>Görsel dosyası<input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy || !canWriteDraft || (product.status === "published" && !canPublish) || product.branchIds.length !== 1} onChange={(event) => { setImageFile(event.target.files?.[0] ?? null); imageRequest.current = null; setImageError(""); }} /></label><button type="button" className="soft-button" disabled={!imageFile || imageBusy || !canWriteDraft || (product.status === "published" && !canPublish) || product.branchIds.length !== 1} onClick={() => void (async () => {
              if (!imageFile || !ctx.branchApiId) return;
              if (imageFile.size > 2 * 1024 * 1024) { setImageError("Görsel en fazla 2 MB olabilir."); return; }
              if (!imageRequest.current || imageRequest.current.file !== imageFile || imageRequest.current.version !== product.version) imageRequest.current = { file: imageFile, version: product.version, id: crypto.randomUUID() };
              const { id, version } = imageRequest.current;
              const path = `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/catalog/products/${encodeURIComponent(product.id)}/images?requestId=${id}&expectedVersion=${version}`;
              setImageBusy(true); setImageError(""); setSaveNotice("");
              try {
                const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, { method: "PUT", headers: { "X-Demo-Actor": ctx.isMulti ? "manager-multi" : "manager-single", "Content-Type": imageFile.type || "application/octet-stream" }, body: imageFile });
                if (!response.ok) { const problem = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(problem.detail ?? "Görsel kaydedilemedi."); }
                imageRequest.current = null; setImageFile(null); if (imageInput.current) imageInput.current.value = ""; notifyChange(); setSaveNotice("Ürün görseli kaydedildi.");
              } catch (reason) { setImageError(reason instanceof Error ? reason.message : "Görsel kaydedilemedi."); }
              finally { setImageBusy(false); }
            })()}>{imageBusy ? "Yükleniyor…" : "Görseli kaydet"}</button>{imageError && <p className="notice" role="alert">{imageError}</p>}</section>}
            <div className="info-grid">
              <div>
                <span>Kategori</span>
                <strong>{product.category.name}</strong>
              </div>
              <div>
                <span>Fiyat</span>
                <strong>{formatCatalogMoney(product.price)}</strong>
                <small>
                  {product.priceSource === "branch_override"
                    ? "Şube istisnası"
                    : source === "http" && ctx.branchApiId && product.branchIds.length === 1
                      ? "Bu şubenin fiyatı"
                    : "Merkez fiyatı"}
                </small>
              </div>
              <div>
                <span>Stok kodu</span>
                <strong>{product.sku}</strong>
              </div>
            </div>
          </section>
          <section className="card detail-card">
            <span className="card-kicker">GÖRÜNÜRLÜK</span>
            <h2>Satış kanalları</h2>
            <div className="detail-row">
              <span>Satış kanalları</span>
              <div className="channel-list">
                {product.channels.map((channel) => (
                  <span key={channel}>{channelLabels[channel]}</span>
                ))}
              </div>
            </div>
          </section>
          <section className="card detail-card">
            <span className="card-kicker">İLİŞKİLER</span>
            <h2>Reçete</h2>
            <div className="detail-row">
              <span>Reçete</span>
              <StatusPill tone={inventorySource === "http"
                ? recipeState.status === "loaded" && recipeState.recipe ? "green" : recipeState.status === "error" ? "orange" : "neutral"
                : product.recipeLinked ? "green" : demoRecipe ? "purple" : "orange"}>
                {inventorySource === "http"
                  ? recipeState.status === "loading" ? "Reçete yükleniyor"
                    : recipeState.status === "error" ? "Reçete API'si kullanılamıyor"
                      : recipeState.recipe ? `Reçete sürümü ${recipeState.recipe.version}` : "Kayıtlı reçete yok"
                  : product.recipeLinked ? "Kalıcı bağlantı" : demoRecipe ? "Örnek gösterim" : "Bu özellik henüz etkin değil"}
              </StatusPill>
            </div>
            {inventorySource === "http" && recipeState.status === "error" && <p role="alert">{recipeState.message}</p>}
            {inventorySource === "http" && recipeState.status === "loaded" && recipeState.recipe && <div className="demo-product-recipe">
              <small>Kalıcı reçete · {recipeState.recipe.portion} · sürüm {recipeState.recipe.version}</small>
              {recipeState.recipe.lines.map((line) => <div className="detail-row" key={line.ingredientId}>
                <span>{line.ingredientName}</span><strong>{line.quantity} {line.unit}</strong>
              </div>)}
              <Link className="subtle-link" to="/admin/inventory/recipes">Reçeteyi yönet <ArrowRight size={15} /></Link>
            </div>}
            {inventorySource !== "http" && demoRecipe && <div className="demo-product-recipe">
              <small>Demo reçete · {demoRecipe.portion} · sürüm {demoRecipe.version}. Veritabanına bağlı değil.</small>
              {demoRecipe.lines.map((line) => {
                const ingredient = singleDemo.ingredients.find((entry) => entry.id === line.ingredientId)!;
                return <div className="detail-row" key={line.ingredientId}>
                  <span>{ingredient.name}</span><strong>{line.quantity} {ingredient.unit}</strong>
                </div>;
              })}
            </div>}
          </section>
          {source === "http" && ctx.branchApiId && <ProductOptionsPanel key={`options:${ctx.firmId}:${ctx.branchApiId}:${product.id}`}
            scope={scope} productId={product.id} canManage={canWriteDraft} onChanged={() => { setSaveNotice("Ürün seçenekleri kaydedildi."); notifyChange(); }} />}
          {source === "http" && ctx.branchApiId && <PricePublicationPanel
            key={`price:${ctx.firmId}:${ctx.branchApiId}:${product.id}`}
            scope={scope} product={product} canSetPrice={canSetPrice} canPublish={canPublish}
            onChanged={(message) => { if (message) setSaveNotice(message); notifyChange(); }} />}
        </div>
        <aside className="detail-aside">
          <section className="card aside-card">
            <span className="card-kicker">YAYIN DURUMU</span>
            <h3>{statusLabel[product.status]}</h3>
            <p>{source === "http" ? "Ürünün satışa açılması ve aktifliği ayrı olarak yönetilir." : "Bu durum örnek veridir; gerçek yayın yapılmaz."}</p>
            <StatusPill
              tone={product.status === "published" ? "green" : "orange"}
            >
              {statusLabel[product.status]} · {source === "http" ? "kayıt durumu" : "örnek"}
            </StatusPill>
          </section>
        </aside>
      </div>
    </div>
  );
}
