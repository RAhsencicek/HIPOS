import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PaymentSimulatorPanel } from "./PaymentSimulatorPanel";
import type { TestOrder } from "./PaymentSimulatorPanel";
import "./styles.css";

type Product = {
  id: string;
  name: string;
  sku: string;
  status: string;
  channels: string[];
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

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180";
const money = (amountMinor: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amountMinor / 100);

async function api<T>(path: string, actor: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
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
  const [scopeKey, setScopeKey] = useState<(typeof scopes)[number]["key"]>("single");
  const scope = scopes.find((item) => item.key === scopeKey)!;
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<TestOrder | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setOrder(null);
    setRetryId(null);
    setProductId("");
    api<{ items: Product[] }>(
      `/api/v1/firms/${scope.firmId}/catalog/products?branchId=${scope.branchId}&page=1&pageSize=100`,
      scope.actor,
    ).then((result) => {
      if (!active) return;
      setProducts(result.items.filter((item) => item.status === "published" &&
        item.channels.includes("pos") && item.price.amountMinor > 0));
      setLoading(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Ürünler yüklenemedi.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [scope.firmId, scope.branchId, scope.actor]);

  const selected = products.find((item) => item.id === productId);
  async function createOrder() {
    if (!selected || saving || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return;
    const orderId = retryId ?? crypto.randomUUID();
    setRetryId(orderId);
    setSaving(true);
    setError("");
    try {
      const created = await api<TestOrder>(
        `/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/sales/orders`,
        scope.actor, { orderId, items: [{ productId: selected.id, quantity }] },
      );
      setOrder(created);
      setRetryId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sipariş kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <header>
        <span className="brand">HIPOS <span>TEST POS</span></span>
        <p>Yalnız geliştirme ortamı · Gerçek tahsilat yapılmaz</p>
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
          onChange={(event) => { setProductId(event.target.value); setRetryId(null); setOrder(null); }}>
          <option value="">Ürün seçin</option>
          {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.price.amountMinor)}</option>)}
        </select>
        <label htmlFor="quantity">Adet</label>
        <input id="quantity" type="number" min="1" max="99" value={quantity}
          onChange={(event) => { setQuantity(Number(event.target.value)); setRetryId(null); setOrder(null); }} />
        {selected && <p className="total">Sipariş toplamı <strong>{money(selected.price.amountMinor * quantity)}</strong></p>}
        <button disabled={!selected || saving || order !== null || quantity < 1 || quantity > 99 || !Number.isInteger(quantity)}
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

createRoot(document.getElementById("root")!).render(<App />);
