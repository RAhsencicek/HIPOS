import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Filter,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ViewContext } from "../../app/context";
import { useCatalogProvider } from "../../app/providers";
import { StatusPill, PageHeading, DemoNotice } from "../../shared/ui";
import { channelLabels, formatCatalogMoney } from "./formatters";
import { useCategoryList, useProductDetail, useProductList } from "./useCatalogData";
import { DraftForm } from "./DraftForm";
import type { CatalogLoad } from "./useCatalogData";
import type { ProductListResponse } from "./contracts";

const statusLabel = { published: "Yayında", draft: "Taslak" } as const;

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

export function CategoriesPage({ ctx }: { ctx: ViewContext }) {
  const { source } = useCatalogProvider();
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useCategoryList(scope);
  return <>
    <PageHeading eyebrow="ÜRÜNLER VE MENÜ" title="Kategoriler"
      description="Seçili kapsamdaki ürünleri kategoriye göre inceleyin." />
    <DemoNotice>{source === "http"
      ? "Kategoriler PostgreSQL ürünlerinden okunur. Kategori oluşturma veya düzenleme henüz gerçek işlem değildir."
      : "Kategoriler örnek ürünlerden oluşturulur; kalıcı kayıt yapılmaz."}</DemoNotice>
    {load.status !== "success" ? <CatalogStatePanel load={load} /> :
      <div className="card content-card">
        <div className="table-scroll"><table className="products-table">
          <thead><tr><th>KATEGORİ</th><th>KOD</th><th>ÜRÜN SAYISI</th></tr></thead>
          <tbody>{load.data.items.map((item) => <tr key={`${item.id}:${item.name}`}>
            <td><strong>{item.name}</strong></td><td>{item.id}</td><td>{item.productCount}</td>
          </tr>)}</tbody>
        </table></div>
        {load.data.items.length === 0 && <div className="empty-list">
          <strong>Bu kapsamda kategori yok</strong>
          <span>Kategori kaydı henüz ayrı bir işlem değil; ürünler eklendiğinde okuma listesi oluşur.</span>
        </div>}
      </div>}
  </>;
}

export function ProductsPage({ ctx, canPreviewNewWork, canWriteDraft }: { ctx: ViewContext; canPreviewNewWork: boolean; canWriteDraft: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [categoryCache, setCategoryCache] = useState<{
    firmId: string;
    items: ProductListResponse["categories"];
  } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { mode, source, notifyChange } = useCatalogProvider();
  const [creating, setCreating] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  useEffect(() => { setCreating(false); setSaveNotice(""); }, [ctx.firmId, ctx.branchApiId]);
  useEffect(() => { setCategory(""); setCategoryCache(null); }, [ctx.firmId]);
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useProductList(scope, query, category || undefined);
  const products = load.status === "success" ? load.data.items : [];
  useEffect(() => {
    if (load.status === "success")
      setCategoryCache({ firmId: ctx.firmId, items: load.data.categories });
  }, [load, ctx.firmId]);
  const categories = load.status === "success" ? load.data.categories
    : categoryCache?.firmId === ctx.firmId ? categoryCache.items : [];
  const detailSuffix = searchParams.toString()
    ? `?${searchParams.toString()}`
    : "";
  const changePreviewMode = (value: string) => {
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
            title={canWriteDraft ? "Gerçek taslak kaydı" : "Şube seçimi ve taslak modülü hazır olmalı"}
            onClick={() => { setSaveNotice(""); setCreating(true); }}>
            <Plus size={17} /> Yeni taslak
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
      <DemoNotice>
        {source === "http"
          ? "Ürünler PostgreSQL'den okunur. Taslak oluşturma gerçek API kaydıdır; fiyat ve yayın işlemleri henüz bağlı değildir."
          : "Ürünler örnek veridir. Ürün ekleme ve kaydetme akışı henüz gerçek kayıt oluşturmaz."}
      </DemoNotice>
      {source === "http" && !canWriteDraft && <div className="notice" role="status">
        Yeni taslak için bir şube seçin ve “Ürün taslakları” özelliğini etkinleştirin. Geçmiş ürünler okunabilir kalır. <Link to="/admin/settings/modules">Modül ayarları</Link>
      </div>}
      {saveNotice && <div className="notice" role="status">{saveNotice}</div>}
      {creating && source === "http" && canWriteDraft && <DraftForm key={`${ctx.firmId}:${ctx.branchApiId}`} scope={scope}
        onCancel={() => { setCreating(false); notifyChange(); }} onSaved={() => {
          setCreating(false); notifyChange(); setSaveNotice("Taslak veritabanına kaydedildi.");
        }} />}
      <div className="scope-bar" style={{ marginBottom: 18 }}>
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
        <span className="scope-hint">
          {source === "http"
            ? "Normal durumda yerel API · diğer durumlar tasarım önizlemesi"
            : "Yalnız tasarım senaryosu · gerçek API yanıtı değil"}
        </span>
      </div>
      <div className="card content-card">
        <div className="tabs">
          <button
            className={category === "" ? "selected" : ""}
            onClick={() => setCategory("")}
          >
            Tüm ürünler{" "}
            <span>
              {load.status === "success" ? load.data.pageInfo.totalItems : "—"}
            </span>
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
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className="icon-button settings-button"
            aria-label="Liste ayarları"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={18} />
          </button>
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
                    <th>REÇETE</th>
                    <th>DURUM</th>
                    <th>{ctx.branchApiId ? "ŞUBE FİYATI" : "MERKEZ FİYATI"}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="product-cell">
                          <div className="food-thumb">{product.image}</div>
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
                        {product.recipeLinked ? (
                          <StatusPill tone="green">Bağlı</StatusPill>
                        ) : (
                          <StatusPill>Eksik</StatusPill>
                        )}
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
                        {formatCatalogMoney(product.price)}
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
              <span>{load.data.pageInfo.totalItems} ürün gösteriliyor</span>
              <span>
                {source === "http" ? "PostgreSQL kataloğu" : "Örnek menü"} · sayfa {load.data.pageInfo.page} /{" "}
                {Math.max(1, load.data.pageInfo.totalPages)}
              </span>
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
            seçenek grubu, alerjen, fiyat, reçete ve kanal görünürlüğünü
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
}: {
  ctx: ViewContext;
  productId: string;
  canWriteDraft: boolean;
}) {
  const { source, notifyChange } = useCatalogProvider();
  const [editing, setEditing] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  useEffect(() => { setEditing(false); setSaveNotice(""); }, [ctx.firmId, ctx.branchApiId, productId]);
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
  return (
    <>
      <Link to="/admin/catalog/products" className="back-link">
        <ArrowLeft size={16} /> Ürünler
      </Link>
      <PageHeading
        eyebrow={source === "http" ? "ÜRÜN AYRINTISI · POSTGRESQL" : "ÜRÜN AYRINTISI · ÖRNEK VERİ"}
        title={product.name}
        description={`Stok kodu: ${product.sku} · ${product.category.name}`}
        action={source === "http" && product.status === "draft" ?
          <button className="primary-button" disabled={!canWriteDraft} onClick={() => { setSaveNotice(""); setEditing(true); }}>Taslağı düzenle</button>
          : <StatusPill tone="purple">Önizleme</StatusPill>}
      />
      {source === "http" && product.status === "draft" && !canWriteDraft && <div className="notice" role="status">
        Taslak okunabilir; yeni değişiklik için bu şubedeki taslak modülü hazır olmalı. <Link to="/admin/settings/modules">Modül ayarları</Link>
      </div>}
      {saveNotice && <div className="notice" role="status">{saveNotice}</div>}
      {editing && source === "http" && canWriteDraft && <DraftForm key={`${ctx.firmId}:${ctx.branchApiId}:${product.id}:${product.version}`}
        scope={scope} product={product} onCancel={() => { setEditing(false); notifyChange(); }}
        onSaved={() => { setEditing(false); notifyChange(); setSaveNotice("Taslak değişikliği veritabanına kaydedildi."); }} />}
      <div className="detail-grid">
        <div className="detail-main">
          <section className="card detail-card">
            <div className="detail-card-head">
              <div className="detail-hero-icon">{product.image}</div>
              <div>
                <span className="card-kicker">TEMEL BİLGİLER</span>
                <h2>{product.name}</h2>
                <p>{product.description} {source === "http" ? "Alanlar veritabanından okunur." : "Alanlar örnek veriden gelir."}</p>
              </div>
            </div>
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
                    : "Merkez fiyatı"}
                </small>
              </div>
              <div>
                <span>Stok kodu</span>
                <strong>{product.sku}</strong>
              </div>
              <div>
                <span>Alerjenler</span>
                <strong>
                  {product.allergens.length
                    ? product.allergens.join(", ")
                    : "Tanımlanmadı"}
                </strong>
              </div>
            </div>
          </section>
          <section className="card detail-card">
            <span className="card-kicker">GÖRÜNÜRLÜK</span>
            <h2>Kanallar ve şubeler</h2>
            <div className="detail-row">
              <span>Satış kanalları</span>
              <div className="channel-list">
                {product.channels.map((channel) => (
                  <span key={channel}>{channelLabels[channel]}</span>
                ))}
              </div>
            </div>
            <div className="detail-row">
              <span>Şube kapsamı</span>
              <strong>
                {ctx.selectedBranch?.name ?? "Tüm şubeler · merkez ürün"}
              </strong>
            </div>
          </section>
          <section className="card detail-card">
            <span className="card-kicker">İLİŞKİLER</span>
            <h2>Reçete ve seçenekler</h2>
            <div className="detail-row">
              <span>Reçete</span>
              <StatusPill tone={product.recipeLinked ? "green" : "orange"}>
                {product.recipeLinked ? "Bağlı göstergesi" : "Kurulum gerekiyor"}
              </StatusPill>
            </div>
            <div className="detail-row">
              <span>Seçenek grupları</span>
              <strong>
                {product.optionGroups.length
                  ? product.optionGroups.join(", ")
                  : "Tanımlanmadı"}
              </strong>
            </div>
          </section>
        </div>
        <aside className="detail-aside">
          <section className="card aside-card">
            <span className="card-kicker">YAYIN DURUMU</span>
            <h3>{statusLabel[product.status]}</h3>
            <p>Gerçek yayın işlemi henüz bağlı değil.</p>
            <StatusPill
              tone={product.status === "published" ? "green" : "orange"}
            >
              {statusLabel[product.status]} · {source === "http" ? "kayıt durumu" : "örnek"}
            </StatusPill>
          </section>
          <section className="card aside-card">
            <span className="card-kicker">BU EKRANDA</span>
            <div className="aside-check">
              <Check size={16} /> Ürün ve fiyat görünümü
            </div>
            <div className="aside-check">
              <Check size={16} /> Kanal kapsamı
            </div>
            <div className="aside-check">
              <Check size={16} /> Reçete bağlantısı
            </div>
            <div className="aside-check muted">
              <Clock3 size={16} /> {source === "http" && product.status === "draft" ? "Taslak kaydı API'ye bağlı" : "Yayın ve diğer kayıt işlemleri planlandı"}
            </div>
          </section>
          <section className="card aside-card muted-aside">
            <ShieldCheck size={21} />
            <p>
              {source === "http"
                ? "Taslak ürünün temel alanları düzenlenebilir. Fiyat, yayın ve diğer işlemler henüz uygulanmadı."
                : "Bu sayfa yalnızca tasarım önizlemesidir. Değişiklikler veritabanına kaydedilmez."}
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
