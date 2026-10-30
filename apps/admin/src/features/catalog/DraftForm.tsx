import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { useCatalogProvider, useFeatureProvider } from "../../app/providers";
import type { CatalogProductDetail, CatalogScope, DraftFields } from "./contracts";
import { CatalogProviderError } from "./contracts";
import { useCategoryList } from "./useCatalogData";
import { parseCatalogPrice } from "./formatters";

const emptyFields: DraftFields = {
  name: "", sku: "", categoryId: "", categoryName: "", description: "",
};

function errorMessage(error: CatalogProviderError): string {
  switch (error.code) {
    case "VERSION_CONFLICT": return "Bu ürün başka bir yerde değiştirildi. Güncel sürümü yükleyip yeniden deneyin.";
    case "FEATURE_DISABLED": return "Ürün veya fiyat özelliği bu şubede kapalı. Yeni kayıt yapılamaz.";
    case "FEATURE_DRAINING": return "Özellik kapanıyor; yeni kayıt başlatılamaz.";
    case "FEATURE_SETUP_REQUIRED": return "Bu özellik için kurulum tamamlanmalı.";
    case "UNAUTHORIZED_SCOPE": case "UNAUTHENTICATED": return "Bu şubede ürün kaydetme yetkisi doğrulanamadı.";
    case "DUPLICATE_SKU": case "DUPLICATE_DRAFT_OR_SKU": return "Bu stok kodu veya ürün kaydı zaten kullanılıyor.";
    case "INVALID_DRAFT": return error.message || "Alanları kontrol edin; zorunlu veya uzunluk sınırını aşan değerler var.";
    case "CATALOG_STORAGE_UNAVAILABLE": return "Katalog veritabanı hazır değil. Kayıt yapılmadı.";
    case "LOAD_FAILED": return "API yanıt vermedi. Sonuç belirsiz; alanları değiştirmeden aynı isteği yeniden deneyin veya formdan çıkıp güncel kaydı kontrol edin.";
    default: return error.message || "Ürün kaydedilemedi.";
  }
}

export function DraftForm({ scope, product, initialCategoryId, canSetPrice = false, onCancel, onSaved }: {
  scope: CatalogScope;
  product?: CatalogProductDetail;
  initialCategoryId?: string;
  canSetPrice?: boolean;
  onCancel: () => void;
  onSaved: (saved: CatalogProductDetail) => void;
}) {
  const { provider, source, notifyChange } = useCatalogProvider();
  const { notifyChange: notifyFeatureChange } = useFeatureProvider();
  const categoryLoad = useCategoryList(scope);
  const [draftId] = useState(() => product?.id ?? crypto.randomUUID());
  const [priceVersionId] = useState(() => crypto.randomUUID());
  const [editRequestId] = useState(() => crypto.randomUUID());
  const [price, setPrice] = useState("");
  const [fields, setFields] = useState<DraftFields>(() => product ? {
    name: product.name, sku: product.sku, categoryId: product.category.id,
    categoryName: product.category.name, description: product.description,
  } : { ...emptyFields, categoryId: initialCategoryId ?? "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CatalogProviderError | null>(null);
  const categories = categoryLoad.status === "success" ? categoryLoad.data.items : [];
  const selectedCategory = categories.find(category => category.id === fields.categoryId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !selectedCategory) return;
    setError(null);
    const amountMinor = product ? null : parseCatalogPrice(price);
    if (!product && amountMinor === null) {
      setError(new CatalogProviderError("INVALID_PRICE", 400, "Pozitif bir fiyat girin; en fazla iki kuruş basamağı kullanın."));
      return;
    }
    if (!product && !canSetPrice) return;
    setSaving(true);
    const normalized: DraftFields = {
      name: fields.name.trim(), sku: fields.sku.trim().toUpperCase(),
      categoryId: selectedCategory.id,
      categoryName: selectedCategory.name, description: fields.description.trim(),
    };
    try {
      if (source !== "http" || !scope.branchId)
        throw new CatalogProviderError("DRAFT_NOT_AVAILABLE", 409, "Gerçek kayıt için yerel API ve şube seçimi gerekir.");
      const saved = product
        ? product.status === "published"
          ? await provider.updatePublishedProduct({ scope, draftId, requestId: editRequestId, expectedVersion: product.version, ...normalized })
          : await provider.updateDraft({ scope, draftId, expectedVersion: product.version, ...normalized })
        : await provider.createPricedProduct({ scope, draftId, priceVersionId, amountMinor: amountMinor!, ...normalized });
      onSaved(saved);
    } catch (unknownError) {
      const next = unknownError instanceof CatalogProviderError
        ? unknownError
        : new CatalogProviderError("LOAD_FAILED", 503, "API yanıt vermedi.");
      setError(next);
      if (["FEATURE_DISABLED", "FEATURE_DRAINING", "FEATURE_SETUP_REQUIRED"].includes(next.code))
        notifyFeatureChange();
    } finally {
      setSaving(false);
    }
  }

  function field(key: "name" | "sku" | "description", label: string, maxLength: number, required = false) {
    return <label className="draft-field">
      <span>{label}</span>
      {key === "description" ? <textarea value={fields[key]} maxLength={maxLength} rows={3} disabled={saving || error?.code === "LOAD_FAILED"}
        onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
        : <input value={fields[key]} maxLength={maxLength} required={required} disabled={saving || error?.code === "LOAD_FAILED"}
          onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />}
    </label>;
  }

  return <section className="card draft-form-card" aria-label={product ? "Ürünü düzenle" : "Yeni ürün"}>
    <h2>{product ? "Ürünü düzenle" : "Yeni ürün"}</h2>
    <p>{product ? product.status === "published" ? "Değişiklikler kaydedildiğinde satış ekranlarına yansır; geçmiş siparişler korunur." : "Ürün bilgilerini güncelleyin." : "Ürünü fiyatıyla kaydedin. Satışa açmayı ürün ayrıntısında seçebilirsiniz."}</p>
    <form onSubmit={submit}>
      <div className="draft-form-grid">
        {field("name", "Ürün adı", 256, true)}
        {field("sku", "Stok kodu", 80, true)}
        <label className="draft-field"><span>Kategori</span>
          <select aria-label="Kategori" required value={selectedCategory?.id ?? ""}
            disabled={saving || error?.code === "LOAD_FAILED" || categoryLoad.status !== "success" || categories.length === 0}
            onChange={(event) => setFields({ ...fields, categoryId: event.target.value })}>
            <option value="">Kategori seçin</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        {!product && <label className="draft-field"><span>Fiyat (TL)</span>
          <input inputMode="decimal" required placeholder="Örn. 125,00" value={price} disabled={saving || error?.code === "LOAD_FAILED"}
            onChange={(event) => setPrice(event.target.value)} />
        </label>}
      </div>
      {!product && !canSetPrice && <div className="notice" role="status">Ürün fiyatı kaydetmek için fiyat özelliği bu şubede açık olmalı. <Link to="/admin/settings/modules">Modül ayarları</Link></div>}
      {categoryLoad.status === "loading" && <p role="status">Kategoriler yükleniyor…</p>}
      {categoryLoad.status === "error" && <div className="notice" role="alert">Kategoriler yüklenemedi: {categoryLoad.error.message} <button type="button" className="soft-button" onClick={notifyChange}>Tekrar dene</button></div>}
      {categoryLoad.status === "success" && categories.length === 0 && <div className="notice">Bu şubede henüz kategori yok. <Link to="/admin/catalog/categories">Önce kategori oluşturun</Link></div>}
      {categoryLoad.status === "success" && fields.categoryId && !selectedCategory && <div className="notice" role="alert">Bu kategori seçili şubede bulunamadı. Lütfen başka bir kategori seçin.</div>}
      {field("description", "Açıklama", 4000)}
      {error && <div className="notice" role="alert">
        <span>{errorMessage(error)} Kayıt başarılı olarak işaretlenmedi.</span>
        {error.code === "VERSION_CONFLICT" && <button type="button" className="soft-button" onClick={onCancel}>Güncel ürünü yükle</button>}
        {["FEATURE_DISABLED", "FEATURE_DRAINING", "FEATURE_SETUP_REQUIRED"].includes(error.code) && <Link to="/admin/settings/modules">Modül ayarları</Link>}
      </div>}
      <div className="draft-actions">
        <button type="button" className="soft-button" onClick={onCancel} disabled={saving}>Vazgeç</button>
        <button type="submit" className="primary-button" disabled={saving || !scope.branchId || !selectedCategory || (!product && !canSetPrice)}>
          {saving ? "Kaydediliyor…" : product ? "Değişiklikleri kaydet" : "Ürünü kaydet"}
        </button>
      </div>
    </form>
  </section>;
}
