import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { useCatalogProvider, useFeatureProvider } from "../../app/providers";
import type { CatalogProductDetail, CatalogScope, DraftFields } from "./contracts";
import { CatalogProviderError } from "./contracts";

const emptyFields: DraftFields = {
  name: "", sku: "", categoryId: "", categoryName: "", description: "",
};

function errorMessage(error: CatalogProviderError): string {
  switch (error.code) {
    case "VERSION_CONFLICT": return "Bu taslak başka bir yerde değiştirildi. Güncel sürümü yükleyip yeniden deneyin.";
    case "FEATURE_DISABLED": return "Taslak özelliği bu şubede kapalı. Yeni kayıt yapılamaz.";
    case "FEATURE_DRAINING": return "Özellik kapanıyor; yeni kayıt başlatılamaz.";
    case "FEATURE_SETUP_REQUIRED": return "Bu özellik için kurulum tamamlanmalı.";
    case "UNAUTHORIZED_SCOPE": case "UNAUTHENTICATED": return "Bu şubede taslak kaydetme yetkisi doğrulanamadı.";
    case "DUPLICATE_SKU": case "DUPLICATE_DRAFT_OR_SKU": return "Bu stok kodu veya taslak kimliği zaten kullanılıyor.";
    case "INVALID_DRAFT": return "Alanları kontrol edin; zorunlu veya uzunluk sınırını aşan değerler var.";
    case "CATALOG_STORAGE_UNAVAILABLE": return "Katalog veritabanı hazır değil. Kayıt yapılmadı.";
    case "LOAD_FAILED": return "API yanıt vermedi. Sonuç belirsiz; alanları değiştirmeden aynı isteği yeniden deneyin veya formdan çıkıp güncel kaydı kontrol edin.";
    default: return error.message || "Taslak kaydedilemedi.";
  }
}

export function DraftForm({ scope, product, onCancel, onSaved }: {
  scope: CatalogScope;
  product?: CatalogProductDetail;
  onCancel: () => void;
  onSaved: (saved: CatalogProductDetail) => void;
}) {
  const { provider, source } = useCatalogProvider();
  const { notifyChange: notifyFeatureChange } = useFeatureProvider();
  const [draftId] = useState(() => product?.id ?? crypto.randomUUID());
  const [fields, setFields] = useState<DraftFields>(() => product ? {
    name: product.name, sku: product.sku, categoryId: product.category.id,
    categoryName: product.category.name, description: product.description,
  } : emptyFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CatalogProviderError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    const normalized: DraftFields = {
      name: fields.name.trim(), sku: fields.sku.trim().toUpperCase(),
      categoryId: fields.categoryId.trim().toLowerCase(),
      categoryName: fields.categoryName.trim(), description: fields.description.trim(),
    };
    try {
      if (source !== "http" || !scope.branchId)
        throw new CatalogProviderError("DRAFT_NOT_AVAILABLE", 409, "Gerçek kayıt için yerel API ve şube seçimi gerekir.");
      const saved = product
        ? await provider.updateDraft({ scope, draftId, expectedVersion: product.version, ...normalized })
        : await provider.createDraft({ scope, draftId, ...normalized });
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

  function field(key: keyof DraftFields, label: string, maxLength: number, required = false) {
    return <label className="draft-field">
      <span>{label}</span>
      {key === "description" ? <textarea value={fields[key]} maxLength={maxLength} rows={3} disabled={saving || error?.code === "LOAD_FAILED"}
        onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
        : <input value={fields[key]} maxLength={maxLength} required={required} disabled={saving || error?.code === "LOAD_FAILED"}
          onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />}
    </label>;
  }

  return <section className="card draft-form-card" aria-label={product ? "Taslağı düzenle" : "Yeni ürün taslağı"}>
    <h2>{product ? "Taslağı düzenle" : "Yeni ürün taslağı"}</h2>
    <p>Yalnız temel taslak alanları veritabanına kaydedilir. Fiyat, yayın ve kanal ayarları henüz bu formda yok.</p>
    <form onSubmit={submit}>
      <div className="draft-form-grid">
        {field("name", "Ürün adı", 256, true)}
        {field("sku", "Stok kodu", 80, true)}
        {field("categoryId", "Kategori kodu", 80, true)}
        {field("categoryName", "Kategori adı", 160, true)}
      </div>
      {field("description", "Açıklama", 4000)}
      {error && <div className="notice" role="alert">
        <span>{errorMessage(error)} Kayıt başarılı olarak işaretlenmedi.</span>
        {error.code === "VERSION_CONFLICT" && <button type="button" className="soft-button" onClick={onCancel}>Güncel taslağı yükle</button>}
        {["FEATURE_DISABLED", "FEATURE_DRAINING", "FEATURE_SETUP_REQUIRED"].includes(error.code) && <Link to="/admin/settings/modules">Modül ayarları</Link>}
      </div>}
      <div className="draft-actions">
        <button type="button" className="soft-button" onClick={onCancel} disabled={saving}>Vazgeç</button>
        <button type="submit" className="primary-button" disabled={saving || !scope.branchId}>
          {saving ? "Kaydediliyor…" : product ? "Taslağı güncelle" : "Taslağı kaydet"}
        </button>
      </div>
    </form>
  </section>;
}
