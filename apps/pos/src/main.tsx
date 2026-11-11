import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PaymentSimulatorPanel } from "./PaymentSimulatorPanel";
import { mountOperationalApp } from "./OperationalApps";
import { createRequestId } from "./requestId";
import { ProductOptionPicker, type OptionSelection } from "./ProductOptionPicker";
import type { TestOrder } from "./PaymentSimulatorPanel";
import "./styles.css";
import { PinPadModal } from "./components/PinPadModal";
import {
  POS_AUTH_CHANGED_EVENT,
  clearPosSession,
  getPosSession,
  posFetch,
  savePosSession,
  type PosSession,
} from "./terminalScope";

type Product = {
  id: string;
  name: string;
  sku: string;
  status: string;
  isActive: boolean;
  channels: string[];
  desiredChannels: string[];
  price: { amountMinor: number; currency: string };
};
type Problem = { detail?: string; code?: string };

const scopes = [
  {
    key: "single", label: "Tek Şube · Örnek Restoran",
    firmId: "11111111-1111-4111-8111-111111111111",
    branchId: "33333333-3333-4333-8333-333333333333",
    actor: "pos-single",
  },
  {
    key: "moda", label: "Çok Şube · Moda",
    firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    branchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    actor: "pos-moda",
  },
] as const;

const money = (amountMinor: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amountMinor / 100);

async function api<T>(path: string, actor: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
        response = await posFetch(path, {
            appKind: "pos",
            demoActor: actor,
            method: body ? "POST" : "GET",
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
    } catch {
        throw new Error("Yerel HIPOS API'sine bağlanılamadı.");
    }
    if (!response.ok) {
        const problem = await response.json().catch(() => ({})) as Problem;
        throw new Error(problem.detail ?? `İşlem başarısız (${response.status}).`);
    }
    return response.json() as Promise<T>;
}

function App() {
    // Kasiyer Oturumu (route bazlı izole JWT)
    const [cashierSession, setCashierSession] = useState<PosSession | null>(() => getPosSession("pos"));

    useEffect(() => {
        const sync = () => setCashierSession(getPosSession("pos"));
        window.addEventListener(POS_AUTH_CHANGED_EVENT, sync);
        return () => window.removeEventListener(POS_AUTH_CHANGED_EVENT, sync);
    }, []);

    // 15 Dakika Hareketsizlik Kilidi (Auto-Lock)
    useEffect(() => {
        if (!cashierSession) return;

        let timer: number;
        const resetTimer = () => {
            window.clearTimeout(timer);
            // 15 dakika (15 * 60 * 1000 ms) hareketsiz kalınca ekranı kilitle
            timer = window.setTimeout(() => {
                clearPosSession("pos");
                setCashierSession(null);
            }, 15 * 60 * 1000);
        };

        // Kullanıcının ekrana dokunma, tıklama veya tuşa basma hareketlerini dinle
        const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];
        events.forEach((name) => window.addEventListener(name, resetTimer));

        resetTimer(); // Sayacı başlat

        return () => {
            window.clearTimeout(timer);
            events.forEach((name) => window.removeEventListener(name, resetTimer));
        };
    }, [cashierSession]);
  const [scopeKey, setScopeKey] = useState<(typeof scopes)[number]["key"]>("single");
  const scope = scopes.find((item) => item.key === scopeKey)!;
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [optionSelection, setOptionSelection] = useState<OptionSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<TestOrder | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);

  useEffect(() => {
    if (!cashierSession) return;
    let active = true;
    setLoading(true);
    setError("");
    setOrder(null);
    setRetryId(null);
    setProductId("");
    setOptionSelection(null);
    const loadProducts = () => api<{ items: Product[] }>(
      `/api/v1/firms/${scope.firmId}/catalog/products?branchId=${scope.branchId}&page=1&pageSize=100`,
      scope.actor,
    ).then((result) => {
      if (!active) return;
      setProducts(result.items.filter((item) => item.status === "published" &&
        item.isActive && item.channels.includes("pos") && item.desiredChannels.includes("pos") && item.price.amountMinor > 0));
      setLoading(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Ürünler yüklenemedi.");
      setLoading(false);
    });
    void loadProducts();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadProducts(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [cashierSession, scope.firmId, scope.branchId, scope.actor]);

  const selected = products.find((item) => item.id === productId);
  async function createOrder() {
    if (!selected || !optionSelection?.valid || saving || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return;
    const orderId = retryId ?? createRequestId();
    setRetryId(orderId);
    setSaving(true);
    setError("");
    try {
      const created = await api<TestOrder>(
        `/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/sales/orders`,
        scope.actor, { orderId, items: [{ productId: selected.id, quantity, options: optionSelection.items.map(item => ({ groupId: item.groupId, optionId: item.optionId, quantity: item.quantity })) }] },
      );
      setOrder(created);
      setRetryId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sipariş kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }
    if (!cashierSession) {
        return (
            <PinPadModal
                title="Kasa Terminali Girişi"
                subtitle="Kasayı açmak için 4 haneli PIN kodunuzu tuşlayın"
                firmId={scope.firmId}
                branchId={scope.branchId}
                appKind="pos"
                allowedRoles={["cashier", "owner", "manager"]}
                onSuccess={(data) => {
                    savePosSession("pos", data);
                    setCashierSession(data);
                }}
            />
        );
    }
  return (
    <main className="shell">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <span className="brand">HIPOS <span>TEST POS</span></span>
          <p>Yalnız geliştirme ortamı · Gerçek tahsilat yapılmaz</p>
          <nav className="role-links"><a href="/cashier">Kasa ekranı</a><a href="/waiter">Garson ekranı</a><a href="/kitchen">Mutfak kuyruğu</a></nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.85rem", color: "#60a5fa", fontWeight: "600" }}>
            Kasiyer: {cashierSession.user.fullName}
          </span>
          <button
            onClick={() => {
              clearPosSession("pos");
              setCashierSession(null);
            }}
            style={{
              padding: "0.3rem 0.75rem",
              fontSize: "0.8rem",
              borderRadius: "9999px",
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              cursor: "pointer",
              fontWeight: "600"
            }}
          >
            Vardiyayı Kapat / Kilitle
          </button>
        </div>
      </header>
      <section className="card">
        <p className="eyebrow">AYRI OPERASYON YÜZÜ</p>
        <h1>Test siparişi ve ödeme durumları</h1>
        <p className="intro">Sipariş PostgreSQL'e kaydolur. Ödeme sonuçları yalnız simüle edilir; gerçek para tahsil edilmez. Yönetici tümünü salt okunur görür.</p>
        <label htmlFor="scope">Test şubesi</label>
        <select id="scope" value={scopeKey} onChange={(event) => setScopeKey(event.target.value as typeof scopeKey)}>
          {scopes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <label htmlFor="product">Yayınlanmış POS ürünü</label>
        <select id="product" value={productId} disabled={loading || products.length === 0 || saving}
          onChange={(event) => { setProductId(event.target.value); setOptionSelection(null); setRetryId(null); setOrder(null); }}>
          <option value="">Ürün seçin</option>
          {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.price.amountMinor)}</option>)}
        </select>
        <label htmlFor="quantity">Adet</label>
        <input id="quantity" type="number" min="1" max="99" value={quantity}
          onChange={(event) => { setQuantity(Number(event.target.value)); setRetryId(null); setOrder(null); }} />
        {selected && <ProductOptionPicker key={`${scope.key}:${selected.id}`} firmId={scope.firmId} branchId={scope.branchId} actor={scope.actor} productId={selected.id} basePriceMinor={selected.price.amountMinor} onChange={(value) => { setOptionSelection(value); setRetryId(null); }} />}
        {selected && <p className="total">Sipariş toplamı <strong>{money((optionSelection?.unitPriceMinor ?? selected.price.amountMinor) * quantity)}</strong></p>}
        <button disabled={!selected || !optionSelection?.valid || saving || order !== null || quantity < 1 || quantity > 99 || !Number.isInteger(quantity)}
          onClick={createOrder}>{saving ? "Kaydediliyor…" : order ? "Sipariş kaydedildi" : "Sipariş oluştur"}</button>
        {loading && <p role="status">Ürünler yükleniyor…</p>}
        {!loading && products.length === 0 && !error && <p role="status">Bu şubede satışa açık POS ürünü yok.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {order && <div className="success" role="status">
          <strong>Sipariş veritabanına kaydedildi.</strong>
          <span>Kimlik: {order.id}</span>
          <span>Durum: Açık · Ödeme durumu: {order.paymentStatus} (test) · {money(order.totalMinor)}</span>
          <small>Yeni sipariş için ürünü veya adedi değiştirebilirsiniz.</small>
        </div>}
      </section>
      {order && <PaymentSimulatorPanel key={`${scope.key}:${order.id}`} scope={scope}
        order={order} onOrderChange={setOrder} />}
    </main>
  );
}

if (!mountOperationalApp()) createRoot(document.getElementById("root")!).render(<App />);
