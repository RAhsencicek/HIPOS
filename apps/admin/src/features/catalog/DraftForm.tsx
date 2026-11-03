import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { UploadCloud, X } from "lucide-react";
import { useCatalogProvider, useFeatureProvider } from "../../app/providers";
import type {
  CatalogOptionGroup,
  CatalogProductDetail,
  CatalogScope,
  DraftFields,
  ProductOptionInput,
} from "./contracts";
import { CatalogProviderError } from "./contracts";
import { useCategoryList } from "./useCatalogData";
import { formatCatalogMoney, parseCatalogPrice } from "./formatters";
import { HttpMenuProvider } from "./MenuProvider";

type OptionSelection = { selected: boolean; min: string; max: string };

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
  const [customError, setCustomError] = useState("");

  // Product Image state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Sales Channels state (Default: POS and QR checked)
  const [selectedChannels, setSelectedChannels] = useState<string[]>(() => product?.desiredChannels ?? ["pos", "qr"]);

  useEffect(() => {
    if (product?.desiredChannels) {
      setSelectedChannels(product.desiredChannels);
    }
  }, [product?.desiredChannels]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Option groups state
  const [availableGroups, setAvailableGroups] = useState<CatalogOptionGroup[]>([]);
  const [optionSelection, setOptionSelection] = useState<Record<string, OptionSelection>>({});
  const [optionsLoading, setOptionsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (source !== "http" || !scope.branchId) return;
    setOptionsLoading(true);
    Promise.all([
      provider.listOptionGroups(scope),
      product ? provider.listProductOptionGroups({ scope, productId: product.id }) : Promise.resolve(null),
    ])
      .then(([all, attached]) => {
        if (!active) return;
        setAvailableGroups(all);
        if (attached) {
          setOptionSelection(
            Object.fromEntries(
              attached.items.map(item => [
                item.groupId,
                {
                  selected: true,
                  min: String(item.minSelections),
                  max: item.maxSelections === null ? "" : String(item.maxSelections),
                },
              ])
            )
          );
        }
      })
      .catch((err: unknown) => {
        if (active) console.warn("Seçenek grupları yüklenemedi:", err);
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provider, scope.firmId, scope.branchId, product?.id, source]);

  const categories = categoryLoad.status === "success" ? categoryLoad.data.items : [];
  const selectedCategory = categories.find(category => category.id === fields.categoryId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !selectedCategory) return;
    setError(null);
    setCustomError("");

    const amountMinor = product ? null : parseCatalogPrice(price);
    if (!product && amountMinor === null) {
      setError(new CatalogProviderError("INVALID_PRICE", 400, "Pozitif bir fiyat girin; en fazla iki kuruş basamağı kullanın."));
      return;
    }
    if (!product && !canSetPrice) return;

    if (imageFile && imageFile.size > 2 * 1024 * 1024) {
      setCustomError("Görsel en fazla 2 MB olabilir.");
      return;
    }

    // Validate option group selection limits
    const optionInputs: ProductOptionInput[] = [];
    for (const group of availableGroups) {
      const sel = optionSelection[group.id];
      if (!sel?.selected) continue;
      if (!/^\d+$/.test(sel.min) || (sel.max !== "" && !/^\d+$/.test(sel.max))) {
        setCustomError(`“${group.name}” için seçim sınırları sıfır veya daha büyük tam sayı olmalı.`);
        return;
      }
      const min = Number(sel.min);
      const max = sel.max === "" ? null : Number(sel.max);
      if (!Number.isSafeInteger(min) || (max !== null && (!Number.isSafeInteger(max) || max < min)) || min > group.items.length) {
        setCustomError(`“${group.name}” için seçim sınırlarını ve seçenek sayısını kontrol edin.`);
        return;
      }
      optionInputs.push({
        groupId: group.id,
        minSelections: min,
        maxSelections: max,
        sortOrder: optionInputs.length,
      });
    }

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

      let currentVersion = saved.version;

      // Save option groups if any were configured or modified
      if (availableGroups.length > 0 && optionInputs.length > 0) {
        try {
          const optionRes = await provider.saveProductOptionGroups({
            scope,
            productId: saved.id,
            requestId: crypto.randomUUID(),
            expectedVersion: currentVersion,
            items: optionInputs,
          });
          currentVersion = optionRes.productVersion;
        } catch (optError) {
          console.warn("Ürün seçenek grupları kaydedilemedi:", optError);
        }
      }

      // Save channel preferences
      if (scope.branchId) {
        try {
          const actor = scope.firmId === "11111111-1111-4111-8111-111111111111" ? "manager-single" : "manager-multi";
          const chanPath = `/api/v1/firms/${encodeURIComponent(scope.firmId)}/branches/${encodeURIComponent(scope.branchId)}/catalog/products/${encodeURIComponent(saved.id)}/channels`;
          const chanRes = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${chanPath}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Demo-Actor": actor,
            },
            body: JSON.stringify({
              requestId: crypto.randomUUID(),
              expectedVersion: currentVersion,
              desiredChannels: selectedChannels,
            }),
          });
          if (chanRes.ok) {
            const chanData = (await chanRes.json().catch(() => ({}))) as { version?: number };
            if (chanData.version) currentVersion = chanData.version;
          }
        } catch (chanError) {
          console.warn("Kanal tercihleri kaydedilemedi:", chanError);
        }
      }

      // Save product image if one was selected
      if (imageFile && scope.branchId) {
        try {
          const reqId = crypto.randomUUID();
          const actor = scope.firmId === "11111111-1111-4111-8111-111111111111" ? "manager-single" : "manager-multi";
          const path = `/api/v1/firms/${encodeURIComponent(scope.firmId)}/branches/${encodeURIComponent(scope.branchId)}/catalog/products/${encodeURIComponent(saved.id)}/images?requestId=${reqId}&expectedVersion=${currentVersion}`;
          const imgRes = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, {
            method: "PUT",
            headers: {
              "X-Demo-Actor": actor,
              "Content-Type": imageFile.type || "application/octet-stream",
            },
            body: imageFile,
          });
          if (!imgRes.ok) {
            const problem = (await imgRes.json().catch(() => ({}))) as { detail?: string };
            console.warn("Görsel yüklenemedi:", problem.detail);
          }
        } catch (imgError) {
          console.warn("Görsel kaydedilirken hata oluştu:", imgError);
        }
      }

      let finalSaved = saved;
      // If creating a new product and POS is selected, publish it immediately
      if (!product && selectedChannels.includes("pos") && scope.branchId) {
        try {
          const pubRes = await provider.publishDraft({
            scope,
            draftId: saved.id,
            publicationId: crypto.randomUUID(),
            expectedVersion: currentVersion,
          });
          currentVersion = pubRes.product.version;
          finalSaved = { ...saved, status: "published", version: pubRes.product.version };
        } catch (pubErr) {
          console.warn("Ürün otomatik yayınlanamadı:", pubErr);
        }
      }

      // If POS is selected and published, automatically ensure product is in active menu
      if (scope.branchId && finalSaved.status === "published" && selectedChannels.includes("pos")) {
        try {
          await new HttpMenuProvider().ensureProductInActiveMenu(scope, saved.id, selectedCategory.name);
        } catch (menuErr) {
          console.warn("Ürün menüye otomatik eklenemedi:", menuErr);
        }
      }

      onSaved(finalSaved);
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
    <div className="draft-form-top">
      <h2>{product ? "Ürünü düzenle" : "Yeni ürün"}</h2>
      <p>{product ? product.status === "published" ? "Değişiklikler kaydedildiğinde satış ekranlarına yansır; geçmiş siparişler korunur." : "Ürün bilgilerini güncelleyin." : "Yeni ürünü görseli, temel bilgileri, satış fiyatı ve seçenek gruplarıyla birlikte kaydedin."}</p>
    </div>

    <form onSubmit={submit} className="draft-form-sections">
      {/* 1. BÖLÜM: TEMEL BİLGİLER */}
      <section className="draft-section">
        <div className="draft-section-header">
          <span className="card-kicker">TEMEL BİLGİLER</span>
          <h3>{product ? "Temel Bilgiler" : "Temel Bilgiler ve Fiyat"}</h3>
          <p className="draft-section-desc">Ürünün görselini, adını, stok kodunu, kategorisini ve satış fiyatını tanımlayın.</p>
        </div>

        {/* Ürün Görseli Alanı */}
        <div className="draft-image-upload-wrap">
          <span className="draft-field-title">Ürün görseli</span>
          <div
            className={`product-image-dropzone ${imageFile ? "has-file" : ""}`}
            onClick={() => imageInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && imageInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) {
                if (dropped.size > 2 * 1024 * 1024) {
                  setImageError("Görsel en fazla 2 MB olabilir.");
                } else {
                  setImageFile(dropped);
                  setImageError("");
                }
              }
            }}
          >
            <input
              ref={imageInputRef}
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              disabled={saving}
              aria-label="Ürün görseli seçin"
              onChange={event => {
                const selected = event.target.files?.[0];
                if (selected) {
                  if (selected.size > 2 * 1024 * 1024) {
                    setImageError("Görsel en fazla 2 MB olabilir.");
                  } else {
                    setImageFile(selected);
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
                <button
                  type="button"
                  className="soft-button draft-image-remove-btn"
                  onClick={e => {
                    e.stopPropagation();
                    setImageFile(null);
                    setImageError("");
                    if (imageInputRef.current) imageInputRef.current.value = "";
                  }}
                >
                  <X size={15} /> Kaldır
                </button>
              </div>
            ) : (
              <div className="product-image-dropzone-prompt">
                <div className="product-image-upload-icon-wrap">
                  <UploadCloud size={24} />
                </div>
                <div className="product-image-dropzone-text">
                  <span>Görsel seçmek için tıklayın veya dosyayı sürükleyin</span>
                  <small>PNG, JPG, WEBP • Maks. 2 MB • Önerilen oran 1:1 kare</small>
                </div>
              </div>
            )}
          </div>
          {imageError && <p className="notice" role="alert" style={{ marginTop: 8 }}>{imageError}</p>}
        </div>

        <div className="draft-form-grid">
          {field("name", "Ürün adı", 256, true)}
          {field("sku", "Stok kodu", 80, true)}
          <label className="draft-field"><span>Kategori</span>
            <select aria-label="Kategori" required value={selectedCategory?.id ?? ""}
              disabled={saving || error?.code === "LOAD_FAILED" || categoryLoad.status !== "success" || categories.length === 0}
              onChange={(event) => setFields({ ...fields, categoryId: event.target.value })}>
              <option value="">Kategori seçin</option>
              {categories.filter(category => category.isActive !== false || category.id === product?.category.id).map(category => <option key={category.id} value={category.id}>{category.name}{category.isActive === false ? " (Pasif)" : ""}</option>)}
            </select>
          </label>
          {!product ? (
            <label className="draft-field"><span>Fiyat (TL)</span>
              <input inputMode="decimal" required placeholder="Örn. 125,00" value={price} disabled={saving || error?.code === "LOAD_FAILED"}
                onChange={(event) => setPrice(event.target.value)} />
            </label>
          ) : (
            <div className="draft-field draft-readonly-field">
              <span>Güncel Fiyat</span>
              <div className="draft-readonly-value">
                <strong>{formatCatalogMoney(product.price)}</strong>
                <small>Fiyat güncellemeleri Fiyat ve Yayın panelinden yönetilir.</small>
              </div>
            </div>
          )}
        </div>

        {!product && !canSetPrice && <div className="notice" role="status">Ürün fiyatı kaydetmek için fiyat özelliği bu şubede açık olmalı. <Link to="/admin/settings/modules">Modül ayarları</Link></div>}
        {categoryLoad.status === "loading" && <p role="status">Kategoriler yükleniyor…</p>}
        {categoryLoad.status === "error" && <div className="notice" role="alert">Kategoriler yüklenemedi: {categoryLoad.error.message} <button type="button" className="soft-button" onClick={notifyChange}>Tekrar dene</button></div>}
        {categoryLoad.status === "success" && categories.length === 0 && <div className="notice">Bu şubede henüz kategori yok. <Link to="/admin/catalog/categories">Önce kategori oluşturun</Link></div>}
        {categoryLoad.status === "success" && fields.categoryId && !selectedCategory && <div className="notice" role="alert">Bu kategori seçili şubede bulunamadı. Lütfen başka bir kategori seçin.</div>}
        {field("description", "Açıklama", 4000)}
      </section>

      {/* 2. BÖLÜM: ÜRÜN SEÇENEKLERİ */}
      <section className="draft-section">
        <div className="draft-section-header">
          <span className="card-kicker">ÜRÜN SEÇENEKLERİ</span>
          <h3>Seçenek Grupları</h3>
          <p className="draft-section-desc">Porsiyon, sos, pişme derecesi veya ekstralar gibi bu üründe sunulacak seçenek gruplarını bağlayın.</p>
        </div>

        {optionsLoading && <p role="status">Seçenek grupları yükleniyor…</p>}

        {!optionsLoading && availableGroups.length === 0 && (
          <div className="draft-options-empty">
            <p>Henüz tanımlı seçenek grubu bulunmuyor. Sol menüdeki <Link to="/admin/catalog/option-groups">Seçenek Grupları</Link> ekranından grup oluşturabilir veya ürünü kaydettikten sonra ekleyebilirsiniz.</p>
          </div>
        )}

        {!optionsLoading && availableGroups.length > 0 && (
          <div className="draft-option-groups-list">
            {availableGroups.map(group => {
              const current = optionSelection[group.id] ?? { selected: false, min: "0", max: "" };
              const update = (patch: Partial<OptionSelection>) =>
                setOptionSelection(previous => ({ ...previous, [group.id]: { ...current, ...patch } }));
              return (
                <div className={`draft-option-group-card ${current.selected ? "is-selected" : ""}`} key={group.id}>
                  <div className="draft-option-group-row">
                    <label className="draft-option-group-label">
                      <input
                        type="checkbox"
                        checked={current.selected}
                        disabled={saving}
                        onChange={event => update({ selected: event.target.checked })}
                      />
                      <strong>{group.name}</strong>
                    </label>
                    <span className="draft-option-group-badge">
                      {group.items.length} seçenek {group.isActive ? "" : "· Pasif"}
                    </span>
                  </div>
                  {current.selected && (
                    <div className="draft-option-limits">
                      <label>
                        <span>En az seçim</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={current.min}
                          disabled={saving}
                          onChange={event => update({ min: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>En çok seçim</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Sınır yok"
                          value={current.max}
                          disabled={saving}
                          onChange={event => update({ max: event.target.value })}
                        />
                      </label>
                      {group.items.length > 0 && (
                        <div className="draft-option-items-preview">
                          {group.items.map(item => (
                            <span key={item.id} className="draft-option-item-pill">
                              {item.name}
                              {item.priceDeltaMinor !== 0 && ` (${item.priceDeltaMinor > 0 ? "+" : ""}${(item.priceDeltaMinor / 100).toFixed(2)} TL)`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. BÖLÜM: GÖRÜNÜRLÜK (Satış Kanalları) */}
      <section className="draft-section">
        <div className="draft-section-header">
          <span className="card-kicker">GÖRÜNÜRLÜK</span>
          <h3>Satış Kanalları</h3>
          <p className="draft-section-desc">
            Ürünün hangi satış kanallarında yayına alınacağını ve aktif olacağını seçin.
          </p>
        </div>

        <div className="channel-controls-grid">
          <label className={`channel-control-card ${selectedChannels.includes("pos") ? "is-active" : ""}`}>
            <input
              type="checkbox"
              checked={selectedChannels.includes("pos")}
              disabled={saving}
              onChange={e => {
                const next = e.target.checked
                  ? [...selectedChannels, "pos"]
                  : selectedChannels.filter(x => x !== "pos");
                setSelectedChannels(next);
              }}
            />
            <div>
              <strong>POS'ta yayınla</strong>
              <small>Kasa ve garson terminallerinde siparişe açık olur.</small>
            </div>
          </label>

          <label className={`channel-control-card ${selectedChannels.includes("qr") ? "is-active" : ""}`}>
            <input
              type="checkbox"
              checked={selectedChannels.includes("qr")}
              disabled={saving}
              onChange={e => {
                const next = e.target.checked
                  ? [...selectedChannels, "qr"]
                  : selectedChannels.filter(x => x !== "qr");
                setSelectedChannels(next);
              }}
            />
            <div>
              <strong>QR'da yayınla</strong>
              <small>Müşterilere açık mobil QR menüde listelenir.</small>
            </div>
          </label>
        </div>
      </section>

      {customError && <div className="notice" role="alert">{customError}</div>}

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
