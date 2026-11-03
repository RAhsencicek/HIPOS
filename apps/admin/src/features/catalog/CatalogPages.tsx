import {
  AlertCircle,
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Filter,
  Info,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { ViewContext } from "../../app/context";
import { useCatalogProvider } from "../../app/providers";
import { StatusPill, PageHeading, DemoNotice } from "../../shared/ui";
import { channelLabels, formatCatalogMoney, parseCatalogPrice } from "./formatters";
import { useCategoryList, useProductDetail, useProductList } from "./useCatalogData";
import { DraftForm } from "./DraftForm";
import { HttpMenuProvider } from "./MenuProvider";
import { HttpCatalogProvider } from "./HttpCatalogProvider";
import { PricePublicationPanel } from "./PricePublicationPanel";
import { ProductOptionsPanel } from "./ProductOptionsPanel";
import { ProductImage } from "./ProductImage";
import type { CatalogLoad } from "./useCatalogData";
import type { CatalogProduct, CatalogProductDetail, CategoryListResponse, ProductListResponse } from "./contracts";
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
  const [deleteError, setDeleteError] = useState("");
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

  async function deleteCategory(category: CategoryListResponse["items"][number]) {
    if (!canEdit || saving) return;
    const linkedProductNote = category.productCount > 0
      ? ` Bu kategorideki ${category.productCount} ürün korunacak ve kategorisiz kalacak.`
      : "";
    if (!window.confirm(`“${category.name}” kategorisi silinsin mi?${linkedProductNote} Bu işlem geri alınamaz.`)) return;
    setSaving(true);
    setDeleteError("");
    try {
      if (category.version === undefined) throw new Error("Kategori sürümü alınamadı. Güncel kayıtları yükleyip tekrar deneyin.");
      await provider.deleteCategory({ scope, categoryId: category.id, expectedVersion: category.version });
      setNotice(`“${category.name}” kategorisi silindi.`);
      notifyChange();
    } catch (reason) {
      setNotice("");
      setDeleteError(reason instanceof Error ? reason.message : "Kategori silinemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function setCategoryActive(category: CategoryListResponse["items"][number]) {
    if (!canEdit || saving || category.version === undefined) return;
    setSaving(true); setDeleteError(""); setNotice("");
    try {
      const isActive = category.isActive === false;
      await provider.setCategoryActive({ scope, categoryId: category.id, expectedVersion: category.version, isActive });
      setNotice(`“${category.name}” kategorisi ${isActive ? "etkinleştirildi" : "pasife alındı"}.`);
      notifyChange();
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : "Kategori durumu değiştirilemedi."); }
    finally { setSaving(false); }
  }

  async function moveCategory(category: CategoryListResponse["items"][number], direction: -1 | 1) {
    const index = categories.findIndex(item => item.id === category.id);
    const neighbor = categories[index + direction];
    if (!canEdit || saving || !neighbor || category.version === undefined || neighbor.version === undefined) return;
    setSaving(true); setDeleteError(""); setNotice("");
    try {
      await provider.moveCategory({ scope, categoryId: category.id, expectedVersion: category.version, neighborId: neighbor.id, neighborVersion: neighbor.version });
      setNotice("Kategori sırası güncellendi."); notifyChange();
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : "Kategori sırası değiştirilemedi."); }
    finally { setSaving(false); }
  }

  return <>
    <PageHeading eyebrow="ÜRÜNLER VE MENÜ" title="Kategoriler"
      description={selectedBranchName
        ? `${selectedBranchName} şubesinin kategorilerini görüntüleyin ve yönetin.`
        : "Kategorileri görüntülemek ve yönetmek için önce bir şube seçin."}
      action={<button className="primary-button" disabled={!canEdit || load.status !== "success"} onClick={openCreate}
        title={!ctx.branchApiId ? "Önce bir şube seçin" : canEdit ? "Yeni kategori oluştur" : "Örnek veride kategori kaydedilemez."}><Plus size={17} />Yeni kategori</button>} />
    <div className="category-info-banner"><Info size={17} /><span>Menü bölümleri kategorilerden ayrıdır. Pasif kategorilere yeni ürün eklenemez; mevcut ürünler ve menüler etkilenmez.</span></div>
    {notice && <div className="notice menu-success" role="status"><Check size={16} />{notice}</div>}
    {deleteError && <div className="category-form-error" role="alert"><AlertCircle size={16} />{deleteError}</div>}
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
            <div className="category-row-main"><strong>{category.name}</strong> <StatusPill tone={category.isActive === false ? "neutral" : "green"}>{category.isActive === false ? "Pasif" : "Aktif"}</StatusPill></div>
            <span className={`category-product-count ${category.productCount ? "has-products" : "empty"}`}>
              {category.productCount} ürün
            </span>
            <div className="category-row-actions">
              <button type="button" className="soft-button" disabled={!canEdit || saving || Boolean(query.trim()) || categories[0]?.id === category.id} aria-label={`${category.name} kategorisini yukarı taşı`} title="Yukarı taşı" onClick={() => void moveCategory(category, -1)}><ArrowUp size={16} /></button>
              <button type="button" className="soft-button" disabled={!canEdit || saving || Boolean(query.trim()) || categories[categories.length - 1]?.id === category.id} aria-label={`${category.name} kategorisini aşağı taşı`} title="Aşağı taşı" onClick={() => void moveCategory(category, 1)}><ArrowDown size={16} /></button>
              <Link className="soft-button" to={productsUrl(category.id)} aria-label={`${category.name} ürünlerini gör`}>Ürünleri gör</Link>
              {canWriteDraft && category.isActive !== false ? <Link className="soft-button" to={productsUrl(category.id, true)} aria-label={`${category.name} kategorisine ürün ekle`}><Plus size={15} />Ürün ekle</Link>
                : <button className="soft-button" disabled title="Ürün eklemek için ürün ve fiyat özellikleri bu şubede hazır olmalı."><Plus size={15} />Ürün ekle</button>}
              <button type="button" className="soft-button" disabled={!canEdit || saving} onClick={() => void setCategoryActive(category)} aria-label={`${category.name} ${category.isActive === false ? "etkinleştir" : "pasife al"}`}>{category.isActive === false ? "Etkinleştir" : "Pasife al"}</button>
              <button className="soft-button category-edit-button" disabled={!canEdit} title={canEdit ? "Kategori adını düzenle" : "Örnek veride kategori düzenlenemez."}
                onClick={() => openEdit(category)}><Pencil size={15} />Düzenle</button>
              <button className="soft-button" disabled={!canEdit || saving}
                title={canEdit ? "Kategoriyi ve kategori bağlarını sil" : "Örnek veride kategori silinemez."}
                onClick={() => void deleteCategory(category)}><Trash2 size={15} />Sil</button>
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
          onChange={event => setCategoryName(event.target.value)} /></label>
        {formError && <div className="category-form-error" role="alert"><AlertCircle size={16} />{formError}</div>}
        <footer><button type="button" className="soft-button" disabled={saving} onClick={() => setDialog(null)}>Vazgeç</button>
          <button type="submit" className="primary-button" disabled={saving || !categoryName.trim()}>
            {saving ? "Kaydediliyor…" : dialog.kind === "create" ? "Kategori oluştur" : "Değişiklikleri kaydet"}</button></footer>
      </form>
    </section></div>}
  </>;
}

function GalleryProduct({ product, ctx, canWriteDraft, canPublish }: { product: CatalogProduct; ctx: ViewContext; canWriteDraft: boolean; canPublish: boolean }) {
  const { source, notifyChange } = useCatalogProvider();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<{ file: File; version: number; id: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const enabled = source === "http" && !!ctx.branchApiId && canWriteDraft && (product.status !== "published" || canPublish) && product.branchIds.length === 1;
  useEffect(() => {
    if (!file) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function upload() {
    if (!file || !ctx.branchApiId || !enabled || busy) return;
    if (file.size > 2 * 1024 * 1024) { setMessage("Görsel en fazla 2 MB olabilir."); return; }
    if (!request.current || request.current.file !== file || request.current.version !== product.version)
      request.current = { file, version: product.version, id: crypto.randomUUID() };
    const { id, version } = request.current;
    const path = `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/catalog/products/${encodeURIComponent(product.id)}/images?requestId=${id}&expectedVersion=${version}`;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, { method: "PUT", headers: { "X-Demo-Actor": ctx.isMulti ? "manager-multi" : "manager-single", "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!response.ok) { const problem = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(problem.detail ?? "Görsel kaydedilemedi."); }
      request.current = null; setFile(null); if (input.current) input.current.value = ""; setMessage("Görsel kaydedildi."); notifyChange();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Görsel kaydedilemedi."); }
    finally { setBusy(false); }
  }
  return <article className="card gallery-product">
    <div className="gallery-product-image">{file && previewUrl ? <img src={previewUrl} alt={`${product.name} seçilen görsel önizlemesi`} /> : <ProductImage image={product.image} productId={product.id} firmId={ctx.firmId} branchId={ctx.branchApiId} actor={ctx.isMulti ? "manager-multi" : "manager-single"} name={product.name} />}</div>
    <strong>{product.name}</strong><span>{product.category.name} · {product.sku}</span>
    <Link to={`/admin/catalog/products/${encodeURIComponent(product.id)}`}>Ürün ayrıntısı</Link>
    <label className={`gallery-upload${!enabled || busy ? " is-disabled" : ""}`}>
      <input ref={input} className="gallery-upload-input" type="file" accept="image/jpeg,image/png,image/webp" disabled={!enabled || busy} aria-label={`${product.name} için görsel seç`} onChange={event => { setFile(event.target.files?.[0] ?? null); request.current = null; setMessage(""); }} />
      <span className="gallery-upload-icon"><UploadCloud size={19} /></span>
      <span className="gallery-upload-copy"><strong>{file ? "Görsel seçildi" : "Görsel seç"}</strong><small title={file?.name}>{file ? file.name : "JPEG, PNG veya WebP · en fazla 2 MB"}</small></span>
    </label>
    <button type="button" className="soft-button" disabled={!enabled || !file || busy} onClick={() => void upload()}>{busy ? "Yükleniyor…" : "Görseli kaydet"}</button>
    {!enabled && <small>Görsel yüklemek için yetkili şube seçimi ve tek şubeli ürün gerekir.</small>}
    {message && <small role="status">{message}</small>}
  </article>;
}

function ChannelControls({ product, ctx, canWriteDraft, canPublish }: { product: CatalogProduct; ctx: ViewContext; canWriteDraft: boolean; canPublish: boolean }) {
  const { source, notifyChange } = useCatalogProvider();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ channels: string[]; version: number; id: string } | null>(null);
  const desired = product.desiredChannels ?? ["pos", "qr"];
  const canEdit = source === "http" && canWriteDraft && (product.status !== "published" || canPublish) && !!ctx.branchApiId && product.branchIds.length === 1;
  async function update(channels: string[]) {
    if (!canEdit || busy || !ctx.branchApiId) return;
    const approvingPos = product.status === "draft" && channels.includes("pos");
    if (approvingPos && !product.isActive) { setError("POS'ta yayınlamak için önce ürünü etkinleştirin."); return; }
    if (approvingPos && product.price.amountMinor <= 0) { setError("POS'ta yayınlamak için önce Şube fiyatı bölümünden geçerli bir fiyat kaydedin."); return; }
    const selected = [...new Set(channels)].sort();
    if (!pending.current || pending.current.version !== product.version || JSON.stringify(pending.current.channels) !== JSON.stringify(selected))
      pending.current = { channels: selected, version: product.version, id: crypto.randomUUID() };
    const command = pending.current;
    setBusy(true); setError("");
    let qrMenuUpdated = false;
    try {
      const path = `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/catalog/products/${encodeURIComponent(product.id)}/channels`;
      const actor = ctx.firmId === "11111111-1111-4111-8111-111111111111" ? "manager-single" : (ctx.isMulti ? "manager-multi" : "manager-single");
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Demo-Actor": actor }, body: JSON.stringify({ requestId: command.id, expectedVersion: command.version, desiredChannels: command.channels }) });
      if (!response.ok) { const problem = await response.json().catch(() => ({})) as { detail?: string }; pending.current = null; throw new Error(problem.detail ?? "Kanal seçimi kaydedilemedi."); }
      const channelResult = await response.json() as { version: number };
      pending.current = null;
      if (approvingPos) {
        await new HttpCatalogProvider().publishDraft({ scope: { firmId: ctx.firmId, branchId: ctx.branchApiId }, draftId: product.id,
          publicationId: crypto.randomUUID(), expectedVersion: channelResult.version });
        if (command.channels.includes("qr"))
          qrMenuUpdated = await new HttpMenuProvider().ensureProductInActiveMenu(
            { firmId: ctx.firmId, branchId: ctx.branchApiId }, product.id, product.category.name,
          );
      } else if (command.channels.includes("pos") && product.status === "published") {
        qrMenuUpdated = await new HttpMenuProvider().ensureProductInActiveMenu(
          { firmId: ctx.firmId, branchId: ctx.branchApiId }, product.id, product.category.name,
        );
      }
      notifyChange();
      if (command.channels.includes("pos") && command.channels.includes("qr") && !qrMenuUpdated)
        setError("Ürün POS'ta yayınlandı; QR menüye eklenemedi. Şubede aktif menü bulunduğunu kontrol edin.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Kanal seçimi kaydedilemedi."); }
    finally { setBusy(false); }
  }
  return <div className="channel-controls">
    <div className="channel-controls-grid">
      <label className={`channel-control-card ${desired.includes("pos") ? "is-active" : ""}`}>
        <input type="checkbox" checked={product.status === "published" && desired.includes("pos")} disabled={!canEdit || busy || (product.status === "draft" && (!product.isActive || product.price.amountMinor <= 0))} onChange={event => void update(event.target.checked ? [...desired, "pos"] : desired.filter(x => x !== "pos"))} />
        <div>
          <strong>POS'ta yayınla</strong>
          <small>{product.status === "draft" ? "Seçtiğinizde ürün fiyatıyla birlikte POS'ta yayınlanır." : "Kasa ve garson terminallerinde siparişe açık olur."}</small>
        </div>
      </label>
      <label className={`channel-control-card ${desired.includes("qr") ? "is-active" : ""}`}>
        <input type="checkbox" checked={desired.includes("qr")} disabled={!canEdit || busy} onChange={event => void update(event.target.checked ? [...desired, "qr"] : desired.filter(x => x !== "qr"))} />
        <div>
          <strong>QR'da yayınla</strong>
          <small>Müşterilere açık mobil QR menüde listelenir.</small>
        </div>
      </label>
    </div>
    {product.status === "draft" && !product.isActive && <small className="channel-controls-note">POS'ta yayınlamak için önce ürünü etkinleştirin.</small>}
    {product.status === "draft" && product.price.amountMinor <= 0 && <small className="channel-controls-note">POS'ta yayınlamak için önce geçerli bir şube fiyatı kaydedin.</small>}
    {!canEdit && <small className="channel-controls-note">Bu ürünün kanal seçimi bu şubeden değiştirilemiyor.</small>}
    {error && <small role="alert" className="channel-controls-error">{error}{pending.current && <button type="button" className="soft-button" onClick={() => void update(pending.current!.channels)}>Tekrar dene</button>}</small>}
  </div>;
}

export function ChannelVisibilityPage({ ctx, canWriteDraft, canSetPrice, canPublish }: { ctx: ViewContext; canWriteDraft: boolean; canSetPrice: boolean; canPublish: boolean }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useProductList(scope, query, undefined, page);
  useEffect(() => { setPage(1); setSelectedId(""); setNotice(""); }, [ctx.firmId, ctx.branchApiId]);
  return <>
    <PageHeading eyebrow="ÜRÜNLER VE MENÜ" title="Kanal Görünürlüğü" description="Ürünlerin POS yayın durumunu ve satış kanallarının hazırlık durumunu inceleyin." />
    {notice && <div className="notice menu-success" role="status">{notice}</div>}
    {!ctx.branchApiId ? <div className="notice">Ürünleri görmek için bir şube seçin.</div> : <>
      <div className="channel-overview"><div className="card"><strong>POS</strong><span>Seçim yeni satışlarda geçerli</span></div><div className="card"><strong>Paket servis</strong><span>Tercih kaydedilir; satış ekranı planlanıyor</span></div><div className="card"><strong>QR menü</strong><span>Tercih kaydedilir; QR menü planlanıyor</span></div></div>
      <section className="card channel-visibility-list"><header><div><h2>Ürünler</h2><p>Ürün aktifliği, kanal tercihi ve POS yayın kaydı ayrı gösterilir.</p></div><label className="category-search"><Search size={17} /><input aria-label="Ürün ara" placeholder="Ürün veya stok kodu ara" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label></header>
        {load.status !== "success" ? <CatalogStatePanel load={load} /> : <>
          {load.data.items.length === 0 ? <div className="notice">Ürün bulunamadı.</div> : <div className="channel-rows"><div className="channel-row-heading" aria-hidden="true"><div>Ürün</div><div>Ürün durumu</div><div>POS yayını</div><div>Satış kanalları</div><div>İşlemler</div></div>{load.data.items.map(product => <article className="channel-row" key={product.id}>
            <div className="channel-row-product"><span className="channel-product-image"><ProductImage image={product.image} productId={product.id} firmId={ctx.firmId} branchId={ctx.branchApiId} actor={ctx.isMulti ? "manager-multi" : "manager-single"} name={product.name} /></span><div><Link className="channel-product-link" to={`/admin/catalog/products/${encodeURIComponent(product.id)}`}>{product.name}</Link><small>{product.category.name} · {product.sku}</small></div></div>
            <div><small className="channel-status-label">Ürün durumu</small><StatusPill tone={product.isActive ? "green" : "neutral"}>{product.isActive ? "Aktif" : "Pasif"}</StatusPill></div>
            <div><small className="channel-status-label">POS yayını</small><StatusPill tone={product.status === "published" && product.channels.includes("pos") ? "green" : "neutral"}>{product.status === "published" && product.channels.includes("pos") ? "Yayın kaydı var" : "Yayınlanmadı"}</StatusPill></div>
            <ChannelControls product={product} ctx={ctx} canWriteDraft={canWriteDraft} canPublish={canPublish} />
            <div className="channel-row-actions"><button type="button" className="soft-button" aria-pressed={selectedId === product.id} onClick={() => { setSelectedId(selectedId === product.id ? "" : product.id); setNotice(""); }}>Yayın işlemleri</button></div>
            {selectedId === product.id && <div className="channel-row-publication"><PublicationProductPanel key={selectedId} ctx={ctx} productId={selectedId} canSetPrice={canSetPrice} canPublish={canPublish} onChanged={message => setNotice(message ?? "")} /></div>}
          </article>)}</div>}
          <div className="catalog-pagination"><button className="soft-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</button><span>Sayfa {page} / {Math.max(1, load.data.pageInfo.totalPages)}</span><button className="soft-button" disabled={page >= load.data.pageInfo.totalPages} onClick={() => setPage(page + 1)}>Sonraki</button></div>
        </>}
      </section>
    </>}
  </>;
}

function SchedulePriceForm({ ctx, product, canSetPrice, canPublish, onSaved }: { ctx: ViewContext; product: CatalogProductDetail; canSetPrice: boolean; canPublish: boolean; onSaved: () => void }) {
  const { provider, source } = useCatalogProvider();
  const [price, setPrice] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const enabled = source === "http" && canSetPrice && (product.status !== "published" || canPublish);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const amountMinor = parseCatalogPrice(price);
    const timestamp = new Date(effectiveAt);
    if (amountMinor === null || !effectiveAt || !Number.isFinite(timestamp.getTime()) || timestamp.getTime() <= Date.now()) { setError("Pozitif bir fiyat ve gelecekteki bir tarih ve saat girin."); return; }
    if (!enabled || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await provider.schedulePrice({ scope: { firmId: ctx.firmId, branchId: ctx.branchApiId }, requestId: requestId.current, productId: product.id, amountMinor, effectiveAt: timestamp.toISOString(), expectedVersion: product.version });
      requestId.current = crypto.randomUUID(); setPrice(""); setEffectiveAt(""); setMessage("Fiyat planı kaydedildi."); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Fiyat planı kaydedilemedi."); }
    finally { setBusy(false); }
  }
  return <section className="card price-history-panel"><h2>İleri tarihli fiyat</h2><p>Güncel fiyat: <strong>{formatCatalogMoney(product.price)}</strong></p>
    <form className="scheduled-price-form" onSubmit={event => void submit(event)}>
      <label>Yeni fiyat (TL)<input inputMode="decimal" value={price} disabled={!enabled || busy} onChange={event => { setPrice(event.target.value); requestId.current = crypto.randomUUID(); }} required /></label>
      <label>Başlangıç tarihi ve saati<input type="datetime-local" value={effectiveAt} disabled={!enabled || busy} onChange={event => { setEffectiveAt(event.target.value); requestId.current = crypto.randomUUID(); }} required /></label>
      <small>Tarih ve saat cihazınızın yerel saatine göre yorumlanır. Zamanı geldiğinde planlanan fiyat uygulanır.</small>
      <button className="primary-button" disabled={!enabled || busy}>{busy ? "Kaydediliyor…" : "Fiyatı planla"}</button>
      {!enabled && <small>Plan oluşturmak için fiyat yönetimi ve yayımlanmış ürünlerde POS yayını etkin olmalı.</small>}
      {error && <div className="notice" role="alert">{error}</div>}{message && <div className="notice menu-success" role="status">{message}</div>}
    </form>
  </section>;
}

function ScheduledPriceSection({ ctx, product, canSetPrice, canPublish }: { ctx: ViewContext; product: CatalogProductDetail; canSetPrice: boolean; canPublish: boolean }) {
  return <SchedulePriceForm key={`${product.id}:${product.version}`} ctx={ctx} product={product} canSetPrice={canSetPrice} canPublish={canPublish} onSaved={() => {}} />;
}

function PriceProductPanel({ ctx, productId, canSetPrice, canPublish, onPriceChanged }: { ctx: ViewContext; productId: string; canSetPrice: boolean; canPublish: boolean; onPriceChanged: (message?: string) => void }) {
  const { notifyChange } = useCatalogProvider();
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const product = useProductDetail(scope, productId);
  if (product.status !== "success") return <CatalogStatePanel load={product} />;
  return <div className="price-product-detail"><PricePublicationPanel scope={scope} product={product.data} canSetPrice={canSetPrice} canPublish={canPublish} onChanged={message => { onPriceChanged(message); notifyChange(); }} />
    <ScheduledPriceSection ctx={ctx} product={product.data} canSetPrice={canSetPrice} canPublish={canPublish} />
  </div>;
}

export function PriceManagementPage({ ctx, canSetPrice, canPublish }: { ctx: ViewContext; canSetPrice: boolean; canPublish: boolean }) {
  const { notifyChange } = useCatalogProvider();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useProductList(scope, query, undefined, page);
  useEffect(() => { setPage(1); setSelectedId(""); }, [ctx.firmId, ctx.branchApiId]);
  return <><PageHeading eyebrow="ÜRÜNLER VE MENÜ" title="Fiyatlar" description="Ürün fiyatlarını, geçmiş sürümleri ve ileri tarihli fiyat planlarını yönetin." />
    {notice && <div className="notice menu-success" role="status">{notice}</div>}
    {!ctx.branchApiId ? <div className="notice">Fiyatları görmek için bir şube seçin.</div> : <div className="price-workspace">
      <section className="card price-product-list"><label className="category-search"><Search size={17} /><input aria-label="Ürün ara" placeholder="Ürün veya stok kodu ara" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label><button type="button" className="soft-button" onClick={notifyChange}>Fiyatları yenile</button>
        {load.status !== "success" ? <CatalogStatePanel load={load} /> : <>
          {load.data.items.map(product => <button type="button" key={product.id} className={`price-product-row${selectedId === product.id ? " selected" : ""}`} aria-pressed={selectedId === product.id} onClick={() => { setSelectedId(product.id); setNotice(""); }}><span><strong>{product.name}</strong><small>{product.category.name} · {product.sku}</small></span><strong>{formatCatalogMoney(product.price)}</strong></button>)}
          {!load.data.items.length && <p>Ürün bulunamadı.</p>}
          <div className="catalog-pagination"><button className="soft-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</button><span>{page} / {Math.max(1, load.data.pageInfo.totalPages)}</span><button className="soft-button" disabled={page >= load.data.pageInfo.totalPages} onClick={() => setPage(page + 1)}>Sonraki</button></div>
        </>}
      </section>
      {selectedId ? <PriceProductPanel key={selectedId} ctx={ctx} productId={selectedId} canSetPrice={canSetPrice} canPublish={canPublish} onPriceChanged={message => setNotice(message ?? "")} /> : <div className="card price-history-panel">Ayrıntıları görmek için bir ürün seçin.</div>}
    </div>}
  </>;
}

function PublicationProductPanel({ ctx, productId, canSetPrice, canPublish, onChanged }: { ctx: ViewContext; productId: string; canSetPrice: boolean; canPublish: boolean; onChanged: (message?: string) => void }) {
  const { notifyChange } = useCatalogProvider();
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useProductDetail(scope, productId);
  if (load.status !== "success") return <CatalogStatePanel load={load} />;
  const product = load.data;
  const published = product.status === "published" && product.channels.includes("pos");
  const posSelected = product.desiredChannels?.includes("pos") ?? true;
  return <div className="price-product-detail">
    <section className="card publication-product-summary"><div className="channel-row-product"><span className="channel-product-image"><ProductImage image={product.image} productId={product.id} firmId={ctx.firmId} branchId={ctx.branchApiId} actor={ctx.isMulti ? "manager-multi" : "manager-single"} name={product.name} /></span><div><h2>{product.name}</h2><small>{product.category.name} · {product.sku}</small></div></div>
      <div className="publication-summary-status"><StatusPill tone={published ? "green" : "neutral"}>{published ? "POS yayın kaydı var" : "Henüz yayınlanmadı"}</StatusPill><StatusPill tone={product.isActive ? "green" : "neutral"}>{product.isActive ? "Aktif ürün" : "Pasif ürün"}</StatusPill><strong>{formatCatalogMoney(product.price)}</strong></div>
      {!posSelected && <p role="status">POS kanal tercihi kapalı. Ürünü satışta göstermek için yukarıdaki ürün satırından POS’u açın.</p>}
    </section>
    <PricePublicationPanel scope={scope} product={product} canSetPrice={canSetPrice} canPublish={canPublish} onChanged={message => { onChanged(message); notifyChange(); }} />
  </div>;
}

export function ProductImagesPage({ ctx, canWriteDraft, canPublish }: { ctx: ViewContext; canWriteDraft: boolean; canPublish: boolean }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const scope = { firmId: ctx.firmId, branchId: ctx.branchApiId };
  const load = useProductList(scope, query, undefined, page);
  useEffect(() => { setPage(1); }, [ctx.firmId, ctx.branchApiId]);
  return <>
    <PageHeading eyebrow="ÜRÜNLER VE MENÜ" title="Ürün Görselleri" description="Ürün görsellerini bir arada inceleyin ve güncelleyin." />
    {!ctx.branchApiId ? <div className="notice">Görselleri yönetmek için bir şube seçin.</div> : <>
      <label className="category-search"><Search size={17} /><input aria-label="Ürün ara" placeholder="Ürün veya stok kodu ara" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
      {load.status !== "success" ? <CatalogStatePanel load={load} /> : <>
        {load.data.items.length === 0 ? <div className="notice">Ürün bulunamadı.</div> : <div className="gallery-products">{load.data.items.map(product => <GalleryProduct key={`${ctx.firmId}:${ctx.branchApiId}:${product.id}`} product={product} ctx={ctx} canWriteDraft={canWriteDraft} canPublish={canPublish} />)}</div>}
        <div className="catalog-pagination"><button className="soft-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</button><span>Sayfa {page} / {Math.max(1, load.data.pageInfo.totalPages)}</span><button className="soft-button" disabled={page >= load.data.pageInfo.totalPages} onClick={() => setPage(page + 1)}>Sonraki</button></div>
      </>}
    </>}
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
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const imageRequest = useRef<{ file: File; version: number; id: string } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [activationRequestId, setActivationRequestId] = useState(() => crypto.randomUUID());
  const [recipeState, setRecipeState] = useState<{ status: "loading" } | { status: "loaded"; recipe: InventoryRecipeDetail | null } | { status: "error"; message: string }>({ status: "loading" });
  useEffect(() => { setEditing(false); setSaveNotice(""); setActivationRequestId(crypto.randomUUID()); setImageFile(null); setImagePreviewUrl(null); setImageError(""); imageRequest.current = null; if (imageInput.current) imageInput.current.value = ""; }, [ctx.firmId, ctx.branchApiId, productId]);
  useEffect(() => {
    if (!imageFile) { setImagePreviewUrl(null); return; }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);
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
          <div className="catalog-product-status-group">
            <StatusPill tone={product.isActive ? "green" : "red"}>{product.isActive ? "Ürün aktif" : "Ürün pasif"}</StatusPill>
            {product.status === "published" && <StatusPill tone={product.channels.includes("pos") ? "green" : "neutral"}>{product.channels.includes("pos") ? "POS'ta yayında" : "POS'ta yayınlanmadı"}</StatusPill>}
          </div>
          <span className="catalog-product-actions-divider" aria-hidden="true" />
          <div className="catalog-product-btn-group">
            <button className="primary-button" disabled={!canWriteDraft || (product.status === "published" && (!canPublish || product.branchIds.length !== 1))}
              title={product.status === "published" && product.branchIds.length !== 1 ? "Birden fazla şubedeki ürün bu ekrandan düzenlenemez." : undefined}
              onClick={() => { setSaveNotice(""); setEditing(true); }}><Pencil size={15} />Ürünü düzenle</button>
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
          </div>
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
      {searchParams.get("created") === "1" && !saveNotice && <div className="notice" role="status">{product.status === "published" ? "Ürün kaydedildi ve POS'ta yayınlandı." : "Ürün ve fiyat kaydedildi. POS'ta yayınlamak için satış kanallarını kullanın."}</div>}
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
            {source === "http" && ctx.branchApiId && (
              <section className="product-image-upload card" aria-label="Ürün görseli">
                <div className="product-image-upload-header">
                  <div>
                    <strong>Ürün görseli</strong>
                    <p>JPEG, PNG veya WebP seçin (en fazla 2 MB). Görsel, ürün ve menü ekranlarında gösterilir.</p>
                  </div>
                  {imageFile && (
                    <span className="product-image-selected-badge">
                      <Check size={14} /> Dosya seçildi
                    </span>
                  )}
                </div>

                <div
                  className={`product-image-dropzone ${imageFile ? "has-file" : ""}`}
                  onClick={() => imageInput.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => (e.key === "Enter" || e.key === " ") && imageInput.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) {
                      if (dropped.size > 2 * 1024 * 1024) {
                        setImageError("Görsel en fazla 2 MB olabilir.");
                      } else {
                        setImageFile(dropped);
                        imageRequest.current = null;
                        setImageError("");
                      }
                    }
                  }}
                >
                  <input
                    id="product-image-file-input"
                    ref={imageInput}
                    type="file"
                    className="sr-only"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="Ürün görseli seçin"
                    disabled={imageBusy || !canWriteDraft || (product.status === "published" && !canPublish) || product.branchIds.length !== 1}
                    onChange={event => {
                      const selected = event.target.files?.[0];
                      if (selected) {
                        if (selected.size > 2 * 1024 * 1024) {
                          setImageError("Görsel en fazla 2 MB olabilir.");
                        } else {
                          setImageFile(selected);
                          imageRequest.current = null;
                          setImageError("");
                        }
                      }
                    }}
                  />

                  {imagePreviewUrl ? (
                    <div className="product-image-preview-wrap">
                      <img src={imagePreviewUrl} alt="Seçilen görsel" className="product-image-preview-thumb" />
                      <div className="product-image-file-info">
                        <strong>{imageFile?.name}</strong>
                        <small>{(imageFile!.size / 1024).toFixed(0)} KB · Değiştirmek için tıklayın</small>
                      </div>
                    </div>
                  ) : (
                    <div className="product-image-dropzone-prompt">
                      <div className="product-image-upload-icon-wrap">
                        <UploadCloud size={24} />
                      </div>
                      <div className="product-image-dropzone-text">
                        <span>Görsel seçmek için tıklayın veya dosyayı sürükleyin</span>
                        <small>Maksimum 2 MB · Önerilen oran 1:1 kare</small>
                      </div>
                    </div>
                  )}
                </div>

                <div className="product-image-upload-actions">
                  {imageFile && (
                    <button
                      type="button"
                      className="soft-button"
                      disabled={imageBusy}
                      onClick={e => {
                        e.stopPropagation();
                        setImageFile(null);
                        imageRequest.current = null;
                        if (imageInput.current) imageInput.current.value = "";
                      }}
                    >
                      <X size={15} /> Seçimi Kaldır
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary-button product-image-save-btn"
                    disabled={!imageFile || imageBusy || !canWriteDraft || (product.status === "published" && !canPublish) || product.branchIds.length !== 1}
                    onClick={() => void (async () => {
                      if (!imageFile || !ctx.branchApiId) return;
                      if (imageFile.size > 2 * 1024 * 1024) { setImageError("Görsel en fazla 2 MB olabilir."); return; }
                      if (!imageRequest.current || imageRequest.current.file !== imageFile || imageRequest.current.version !== product.version)
                        imageRequest.current = { file: imageFile, version: product.version, id: crypto.randomUUID() };
                      const { id, version } = imageRequest.current;
                      const path = `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/catalog/products/${encodeURIComponent(product.id)}/images?requestId=${id}&expectedVersion=${version}`;
                      const actor = ctx.firmId === "11111111-1111-4111-8111-111111111111" ? "manager-single" : (ctx.isMulti ? "manager-multi" : "manager-single");
                      setImageBusy(true); setImageError(""); setSaveNotice("");
                      try {
                        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, {
                          method: "PUT",
                          headers: { "X-Demo-Actor": actor, "Content-Type": imageFile.type || "application/octet-stream" },
                          body: imageFile,
                        });
                        if (!response.ok) {
                          const problem = await response.json().catch(() => ({})) as { detail?: string };
                          throw new Error(problem.detail ?? "Görsel kaydedilemedi.");
                        }
                        imageRequest.current = null; setImageFile(null); if (imageInput.current) imageInput.current.value = "";
                        notifyChange(); setSaveNotice("Ürün görseli kaydedildi.");
                      } catch (reason) {
                        setImageError(reason instanceof Error ? reason.message : "Görsel kaydedilemedi.");
                      } finally {
                        setImageBusy(false);
                      }
                    })()}
                  >
                    <Check size={16} />
                    {imageBusy ? "Yükleniyor…" : "Görseli kaydet"}
                  </button>
                </div>

                {imageError && <p className="notice" role="alert">{imageError}</p>}
              </section>
            )}
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
          <section className="card detail-card" aria-label="Satış kanalları">
            <span className="card-kicker">GÖRÜNÜRLÜK</span>
            <h2>Satış kanalları</h2>
            <p className="detail-card-desc">Ürünün hangi satış kanallarında yayına alınacağını ve aktif olacağını yönetin.</p>
            <div className="detail-channel-selection">
              <ChannelControls product={product} ctx={ctx} canWriteDraft={canWriteDraft} canPublish={canPublish} />
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
          {source === "http" && ctx.branchApiId && <ScheduledPriceSection key={`scheduled:${ctx.firmId}:${ctx.branchApiId}:${product.id}`} ctx={ctx} product={product} canSetPrice={canSetPrice} canPublish={canPublish} />}
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
