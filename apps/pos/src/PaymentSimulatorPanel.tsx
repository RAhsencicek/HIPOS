import { useEffect, useState } from "react";
import type { FormEvent } from "react";

export type TestOrder = {
  id: string;
  status: string;
  paymentStatus: string;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  currency: string;
  version: number;
  items: Array<{ productName: string; quantity: number; unitPriceMinor: number }>;
};
type TestScope = { firmId: string; branchId: string; actor: string };
type PaymentAttempt = {
  id: string;
  amountMinor: number;
  method: string;
  status: "succeeded" | "failed" | "pending" | "unknown" | "cancelled";
  simulated: boolean;
};
type PaymentResult = { attempt: PaymentAttempt; order: TestOrder };
type ApiProblem = { code?: string; detail?: string };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180";
const money = (minor: number) => new Intl.NumberFormat("tr-TR", {
  style: "currency", currency: "TRY",
}).format(minor / 100);
const statusLabel: Record<PaymentAttempt["status"], string> = {
  succeeded: "başarılı", failed: "başarısız", pending: "bekliyor",
  unknown: "belirsiz", cancelled: "iptal edildi",
};

class PaymentApiError extends Error {
  constructor(message: string, readonly uncertain = false) { super(message); }
}

async function paymentApi<T>(path: string, actor: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new PaymentApiError("API yanıtı alınamadı. Sonuç belirsiz; aynı kimlikle tekrar deneyin veya kaydı yenileyin.", true);
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as ApiProblem;
    throw new PaymentApiError(problem.detail ?? `İşlem reddedildi (${response.status}).`);
  }
  try { return await response.json() as T; }
  catch { throw new PaymentApiError("API yanıtı okunamadı. Sonucu doğrulamak için kaydı yenileyin.", true); }
}

function toMinor(input: string): number | null {
  const match = /^(0|[1-9]\d{0,7})(?:[,.](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return minor > 0 ? minor : null;
}

export function PaymentSimulatorPanel({ scope, order, onOrderChange }: {
  scope: TestScope; order: TestOrder; onOrderChange: (next: TestOrder) => void;
}) {
  const basePath = `/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/sales/orders/${order.id}`;
  const [amount, setAmount] = useState(() => (order.remainingMinor / 100).toFixed(2));
  const [method, setMethod] = useState<"card" | "cash">("card");
  const [scenario, setScenario] = useState<"succeeded" | "failed" | "pending" | "unknown">("succeeded");
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());
  const [latest, setLatest] = useState<PaymentAttempt | null>(null);
  const [resolution, setResolution] = useState<"succeeded" | "failed" | "cancelled">("succeeded");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [lastAction, setLastAction] = useState<"start" | "resolve" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { if (!uncertain) setAmount((order.remainingMinor / 100).toFixed(2)); }, [order.remainingMinor, uncertain]);
  useEffect(() => {
    let active = true;
    paymentApi<PaymentAttempt[]>(`${basePath}/payment-attempts`, scope.actor)
      .then((attempts) => { if (active) setLatest((current) => current ?? attempts.at(-1) ?? null); })
      .catch(() => { /* Yenile düğmesi hatayı görünür kılar. */ });
    return () => { active = false; };
  }, [basePath, scope.actor]);

  async function start(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const amountMinor = toMinor(amount);
    if (busy || (uncertain && lastAction !== "start")) return;
    if (!amountMinor || (!uncertain && amountMinor > order.remainingMinor)) {
      setError("Pozitif ve kalan tutarı aşmayan bir TL tutarı girin."); return;
    }
    setBusy(true); setError(""); setNotice(""); setLastAction("start");
    try {
      const result = await paymentApi<PaymentResult>(`${basePath}/payment-attempts`, scope.actor, {
        attemptId, amountMinor, method, simulatedOutcome: scenario, expectedOrderVersion: order.version,
      });
      setLatest(result.attempt); onOrderChange(result.order);
      setAttemptId(crypto.randomUUID()); setUncertain(false);
      setNotice(`Simülatör sonucu: ${statusLabel[result.attempt.status]}. Gerçek tahsilat yapılmadı.`);
    } catch (cause) {
      const next = cause instanceof PaymentApiError ? cause : new PaymentApiError("Ödeme simülasyonu başarısız.");
      setError(next.message); setUncertain(next.uncertain);
      if (!next.uncertain) setAttemptId(crypto.randomUUID());
    } finally { setBusy(false); }
  }

  async function resolve() {
    if (!latest || busy || (uncertain && lastAction !== "resolve")) return;
    setBusy(true); setError(""); setNotice(""); setLastAction("resolve");
    try {
      const result = await paymentApi<PaymentResult>(
        `${basePath}/payment-attempts/${latest.id}/resolve`, scope.actor,
        { outcome: resolution, expectedOrderVersion: order.version },
      );
      setLatest(result.attempt); onOrderChange(result.order); setUncertain(false);
      setNotice(`Simülatörde sonuç doğrulandı: ${statusLabel[result.attempt.status]}. Gerçek tahsilat yapılmadı.`);
    } catch (cause) {
      const next = cause instanceof PaymentApiError ? cause : new PaymentApiError("Sonuç doğrulanamadı.");
      setError(next.message); setUncertain(next.uncertain);
    } finally { setBusy(false); }
  }

  async function refresh() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const [fresh, attempts] = await Promise.all([
        paymentApi<TestOrder>(basePath, scope.actor),
        paymentApi<PaymentAttempt[]>(`${basePath}/payment-attempts`, scope.actor),
      ]);
      onOrderChange(fresh); setLatest(attempts.at(-1) ?? null);
      const confirmed = !uncertain || (lastAction === "start"
        ? attempts.some((attempt) => attempt.id === attemptId)
        : attempts.some((attempt) => attempt.id === latest?.id &&
            attempt.status !== "pending" && attempt.status !== "unknown"));
      setUncertain(!confirmed);
      if (confirmed) setAttemptId(crypto.randomUUID());
      setNotice(confirmed
        ? "Sunucudaki sipariş ve simülatör kayıtları yenilendi."
        : "İsteğin kesin sonucu henüz görülmüyor; aynı işlem kimliğiyle tekrar deneyin.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kayıtlar yenilenemedi.");
    } finally { setBusy(false); }
  }

  const unresolved = latest?.status === "pending" || latest?.status === "unknown";
  return <section className="card payment-card" aria-label="Test ödeme simülatörü">
    <p className="eyebrow">YALNIZ TEST · GERÇEK TAHSİLAT YOK</p>
    <h2>Ödeme durumunu simüle et</h2>
    <p>Ödenen: {money(order.paidMinor)} · Kalan: {money(order.remainingMinor)} · Sipariş açık kalır.</p>
    <form onSubmit={(event) => { void start(event); }}>
      <label htmlFor="payment-amount">Simüle tutar (TL)</label>
      <input id="payment-amount" inputMode="decimal" value={amount}
        disabled={busy || uncertain || order.remainingMinor === 0 || unresolved}
        onChange={(event) => { setAmount(event.target.value); setAttemptId(crypto.randomUUID()); }} />
      <label htmlFor="payment-method">Yöntem</label>
      <select id="payment-method" value={method} disabled={busy || uncertain || unresolved}
        onChange={(event) => { setMethod(event.target.value as typeof method); setAttemptId(crypto.randomUUID()); }}>
        <option value="card">Kart senaryosu</option><option value="cash">Nakit senaryosu</option>
      </select>
      <label htmlFor="payment-outcome">Simüle sonuç</label>
      <select id="payment-outcome" value={scenario} disabled={busy || uncertain || unresolved}
        onChange={(event) => { setScenario(event.target.value as typeof scenario); setAttemptId(crypto.randomUUID()); }}>
        <option value="succeeded">Başarılı</option><option value="failed">Başarısız</option>
        <option value="pending">Bekliyor</option><option value="unknown">Belirsiz</option>
      </select>
      <button type="submit" disabled={busy || uncertain || unresolved || order.remainingMinor === 0}>
        {busy ? "İşleniyor…" : "Simüle ödeme girişimi oluştur"}
      </button>
    </form>
    {unresolved && <div className="resolve-box">
      <strong>{latest.status === "unknown" ? "Sonuç belirsiz" : "Sonuç bekliyor"}</strong>
      <p>Yeni ödeme başlatılmaz. Simülatörün kesin sonucunu doğrulayın.</p>
      <label htmlFor="payment-resolution">Doğrulanan sonuç</label>
      <select id="payment-resolution" value={resolution} disabled={busy || (uncertain && lastAction !== "resolve")}
        onChange={(event) => setResolution(event.target.value as typeof resolution)}>
        <option value="succeeded">Başarılı</option><option value="failed">Başarısız</option>
        <option value="cancelled">İptal edildi</option>
      </select>
      <button type="button" disabled={busy || uncertain} onClick={() => { void resolve(); }}>Simülatör sonucunu doğrula</button>
    </div>}
    {uncertain && <button className="secondary" type="button" disabled={busy}
      onClick={() => { if (lastAction === "resolve") void resolve(); else void start(); }}>
      Aynı isteği tekrar dene
    </button>}
    <button className="secondary" type="button" disabled={busy} onClick={() => { void refresh(); }}>Sunucudan durumu yenile</button>
    {error && <p className="error" role="alert">{error} Başarı olarak işaretlenmedi.</p>}
    {notice && <p className="success" role="status">{notice}</p>}
  </section>;
}
