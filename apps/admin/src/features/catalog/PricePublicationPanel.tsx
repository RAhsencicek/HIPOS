import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { useCatalogProvider, useFeatureProvider } from "../../app/providers";
import { formatCatalogMoney } from "./formatters";
import { CatalogProviderError } from "./contracts";
import type { CatalogProductDetail, CatalogScope, PriceVersion, Publication } from "./contracts";

type HistoryLoad =
  | { status: "loading" }
  | { status: "success"; prices: PriceVersion[]; publications: Publication[] }
  | { status: "error"; message: string };

function amountMinor(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return amount > 0 && amount <= 1_000_000_000 ? amount : null;
}

function commandError(error: CatalogProviderError): string {
  switch (error.code) {
    case "VERSION_CONFLICT": return "Taslak başka bir işlemle değişti. Güncel sürümü yükleyin.";
    case "FEATURE_DISABLED": return "Bu işlem modülü bu şubede kapalı; kayıt oluşturulmadı.";
    case "FEATURE_DRAINING": return "Modül kapanıyor; yeni işlem başlatılamaz.";
    case "FEATURE_SETUP_REQUIRED": return "Önce bu özelliğin kurulumunu tamamlayın.";
    case "PRICE_REQUIRED": return "Yayın için önce geçerli bir fiyat sürümü kaydedin.";
    case "UNAUTHORIZED_SCOPE": case "UNAUTHENTICATED": return "Bu şubede işlem yetkisi doğrulanamadı.";
    case "LOAD_FAILED": return "API yanıtı alınamadı. Sonuç belirsiz; aynı işlem kimliğiyle tekrar deneyin veya geçmişi yenileyin.";
    default: return error.message || "İşlem tamamlanamadı.";
  }
}

export function PricePublicationPanel({ scope, product, canSetPrice, canPublish, onChanged }: {
  scope: CatalogScope;
  product: CatalogProductDetail;
  canSetPrice: boolean;
  canPublish: boolean;
  onChanged: (message?: string) => void;
}) {
  const { provider } = useCatalogProvider();
  const { notifyChange: notifyFeatures } = useFeatureProvider();
  const [history, setHistory] = useState<HistoryLoad>({ status: "loading" });
  const [priceInput, setPriceInput] = useState("");
  const [priceId, setPriceId] = useState(() => crypto.randomUUID());
  const [publicationId, setPublicationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState<"price" | "publish" | null>(null);
  const [lastAction, setLastAction] = useState<"price" | "publish" | null>(null);
  const [error, setError] = useState<CatalogProviderError | null>(null);

  useEffect(() => {
    let current = true;
    setHistory({ status: "loading" });
    const request = { scope, productId: product.id };
    Promise.all([provider.listPriceVersions(request), provider.listPublications(request)])
      .then(([prices, publications]) => {
        if (current) setHistory({ status: "success", prices, publications });
      })
      .catch((unknownError: unknown) => {
        if (current) setHistory({ status: "error", message: unknownError instanceof Error ? unknownError.message : "Geçmiş yüklenemedi." });
      });
    return () => { current = false; };
  }, [provider, scope.firmId, scope.branchId, product.id, product.version]);

  if (!scope.branchId) return null;

  function failed(unknownError: unknown) {
    const next = unknownError instanceof CatalogProviderError
      ? unknownError : new CatalogProviderError("LOAD_FAILED", 503, "API yanıt vermedi.");
    setError(next);
    if (["FEATURE_DISABLED", "FEATURE_DRAINING", "FEATURE_SETUP_REQUIRED"].includes(next.code)) notifyFeatures();
  }

  async function sendPrice() {
    if (busy || !canSetPrice || !scope.branchId) return;
    const amount = amountMinor(priceInput);
    if (amount === null) {
      setError(new CatalogProviderError("INVALID_PRICE", 400, "Pozitif bir TL tutarı girin; en fazla iki kuruş basamağı kullanın."));
      return;
    }
    setBusy("price"); setLastAction("price"); setError(null);
    try {
      await provider.setDraftPrice({ scope, draftId: product.id, priceVersionId: priceId,
        amountMinor: amount, expectedVersion: product.version });
      setPriceInput("");
      setPriceId(crypto.randomUUID());
      onChanged("Fiyat sürümü veritabanına kaydedildi.");
    } catch (unknownError) { failed(unknownError); }
    finally { setBusy(null); }
  }

  function savePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendPrice();
  }

  async function publish() {
    if (busy || !canPublish || !scope.branchId) return;
    setBusy("publish"); setLastAction("publish"); setError(null);
    try {
      await provider.publishDraft({ scope, draftId: product.id, publicationId,
        expectedVersion: product.version });
      setPublicationId(crypto.randomUUID());
      onChanged("Ürün POS kanalında yayınlandı; kayıt veritabanında doğrulandı.");
    } catch (unknownError) { failed(unknownError); }
    finally { setBusy(null); }
  }

  const hasPrice = history.status === "success" && history.prices.length > 0;
  return <section className="card detail-card publication-panel" aria-label="Fiyat ve yayın">
    <span className="card-kicker">FİYAT VE YAYIN</span>
    <h2>Şube fiyatı ve POS yayını</h2>
    <p>İlk yayın yalnız seçili şube ve POS kanalı içindir. Ödeme veya gerçek cihaz bağlantısı içermez.</p>
    {product.status === "draft" && <>
      <form onSubmit={savePrice} aria-label="Taslak fiyatı">
        <label className="draft-field">
          <span>Fiyat (TL)</span>
          <input inputMode="decimal" value={priceInput} placeholder="325,50"
            disabled={Boolean(busy) || error?.code === "LOAD_FAILED"}
            onChange={(event) => setPriceInput(event.target.value)} />
        </label>
        <button type="submit" className="primary-button" disabled={Boolean(busy) || !canSetPrice || error?.code === "LOAD_FAILED"}>
          {busy === "price" ? "Kaydediliyor…" : "Fiyat sürümü kaydet"}
        </button>
      </form>
      <div className="publication-action">
        <button type="button" className="primary-button" onClick={publish}
          disabled={Boolean(busy) || !canPublish || !hasPrice || error?.code === "LOAD_FAILED"}>
          {busy === "publish" ? "Yayınlanıyor…" : "POS'a yayınla"}
        </button>
        {!hasPrice && <small>Yayın için önce fiyat geçmişinde geçerli sürüm görünmeli.</small>}
      </div>
      {(!canSetPrice || !canPublish) && <div className="notice" role="status">
        {!canSetPrice ? "Fiyat Taslakları" : "Menü Yayınlama"} bu şubede yeni iş için hazır değil. Geçmiş okunabilir. <Link to="/admin/settings/modules">Modül ayarları</Link>
      </div>}
    </>}
    {error && <div className="notice" role="alert">
      {commandError(error)} İşlem başarılı olarak işaretlenmedi.
      {error.code === "VERSION_CONFLICT" && <button type="button" className="soft-button" onClick={() => onChanged()}>Güncel taslağı yükle</button>}
      {error.code === "LOAD_FAILED" && lastAction && <button type="button" className="soft-button"
        onClick={() => { if (lastAction === "price") void sendPrice(); else void publish(); }}>
        Aynı isteği tekrar dene
      </button>}
      {error.code === "LOAD_FAILED" && <button type="button" className="soft-button" onClick={() => {
        onChanged(); setError(null);
      }}>Kayıtları yenile</button>}
    </div>}
    <div className="publication-history">
      <h3>Fiyat ve yayın geçmişi</h3>
      {history.status === "loading" && <p role="status">Geçmiş yükleniyor…</p>}
      {history.status === "error" && <p role="alert">Geçmiş yüklenemedi: {history.message}</p>}
      {history.status === "success" && <>
        {history.prices.length === 0 && history.publications.length === 0 && <p>Henüz fiyat veya yayın kaydı yok.</p>}
        {history.prices.map((price) => <div className="detail-row" key={price.id}>
          <span>Fiyat sürümü {price.number}</span>
          <strong>{formatCatalogMoney({ amountMinor: price.amountMinor, currency: price.currency })}</strong>
        </div>)}
        {history.publications.map((publication) => <div className="detail-row" key={publication.id}>
          <span>POS yayını {publication.number}</span>
          <strong>{formatCatalogMoney({ amountMinor: publication.amountMinor, currency: publication.currency })}</strong>
        </div>)}
      </>}
    </div>
  </section>;
}
