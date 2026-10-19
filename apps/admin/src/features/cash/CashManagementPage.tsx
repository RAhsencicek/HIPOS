import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, RefreshCw, RotateCcw, Wallet } from "lucide-react";
import type { ViewContext } from "../../app/context";
import { DemoNotice, MetricCard, PageHeading, StatusPill } from "../../shared/ui";

type Register = { id: string; code: string; name: string; providerMode: string; isActive: boolean };
type Shift = { id: string; registerId: string; status: "open" | "closed"; openingCashMinor: number;
  expectedCashMinor: number | null; countedCashMinor: number | null; differenceMinor: number | null;
  openedBy: string; openedAt: string; closedBy: string | null; closedAt: string | null; closeNote: string | null; version: number };
type Movement = { id: string; registerId: string; shiftId: string; kind: string; category: string;
  amountMinor: number; currency: string; description: string; source: string; actor: string; createdAt: string;
  originalMovementId: string | null; correctionType: string | null; correctionReason: string | null };
type OpenShift = { shift: Shift; cashInMinor: number; cashOutMinor: number; movementCount: number; recentMovements: Movement[] };
type Overview = { source: string; simulated: boolean; registers: Register[]; openShifts: OpenShift[] };
type ShiftPage = { items: Shift[]; total: number };
type MovementPage = { items: Movement[]; total: number };
type View = "summary" | "movements" | "shifts" | "opening-closing";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const amountMinor = (value: string) => {
  const trimmed = value.trim().replace(/\s/g, "");
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)
    ? trimmed.replaceAll(".", "").replace(",", ".")
    : trimmed.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : NaN;
};
const titleFor: Record<View, string> = {
  summary: "Kasa özeti", movements: "Kasa hareketleri", shifts: "Kasa vardiyaları", "opening-closing": "Vardiya açılış / kapanış",
};
const movementTitle = (movement: Movement) => movement.kind === "opening_float" ? "Açılış nakdi"
  : movement.kind === "manual_in" ? movement.category === "cash_sale" ? "Nakit satış girişi" : "Nakit girişi"
  : movement.category === "cash_drop" ? "Kasadan teslim" : "Nakit çıkışı";

export function CashManagementPage({ ctx, view, canWrite }: { ctx: ViewContext; view: View; canWrite: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [movementKind, setMovementKind] = useState<"manual_in" | "manual_out">("manual_in");
  const [movementCategory, setMovementCategory] = useState("cash_sale");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementDescription, setMovementDescription] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const scope = ctx.branchApiId
    ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/cash`
    : null;
  const active = overview?.openShifts[0] ?? null;

  const api = useCallback(async <T,>(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, { method,
        headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new Error("Kasa bilgilerine şu anda ulaşılamıyor. Lütfen tekrar deneyin."); }
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(problem.detail ?? `Kasa işlemi başarısız (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }, [actor]);

  const reload = useCallback(async () => {
    if (!scope) { setLoading(false); setError("Önce tek bir şube seçin."); return; }
    setLoading(true); setError("");
    try {
      const [overviewResult, shiftResult, movementResult] = await Promise.all([
        api<Overview>(`${scope}/overview`),
        api<ShiftPage>(`${scope}/shifts?page=1&pageSize=50`),
        api<MovementPage>(`${scope}/movements?page=1&pageSize=100`),
      ]);
      setOverview(overviewResult); setShifts(shiftResult.items); setMovements(movementResult.items);
      setLoading(false);
    } catch (reason) { setError((reason as Error).message); setLoading(false); }
  }, [api, scope]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setMovementCategory(movementKind === "manual_in" ? "cash_sale" : "expense"); }, [movementKind]);

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await reload(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  async function openShift(event: FormEvent) {
    event.preventDefault();
    if (!scope || !overview?.registers[0]) return;
    const openingCashMinor = amountMinor(openingCash);
    if (!Number.isSafeInteger(openingCashMinor)) { setError("Açılış nakdini geçerli TL tutarı olarak girin."); return; }
    await run(async () => {
      await api(`${scope}/shifts`, "POST", { requestId: crypto.randomUUID(), registerId: overview.registers[0].id, openingCashMinor });
      setOpeningCash("");
    }, "Kasa vardiyası açıldı ve açılış nakdi kaydedildi.");
  }

  async function addMovement(event: FormEvent) {
    event.preventDefault();
    if (!scope || !active) return;
    const amount = amountMinor(movementAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || movementDescription.trim().length < 3) {
      setError("Tutarı sıfırdan büyük girin ve en az 3 karakter açıklama yazın."); return;
    }
    await run(async () => {
      await api(`${scope}/shifts/${encodeURIComponent(active.shift.id)}/movements`, "POST", {
        requestId: crypto.randomUUID(), kind: movementKind, amountMinor: amount,
        category: movementCategory, description: movementDescription.trim(),
      });
      setMovementAmount(""); setMovementDescription("");
    }, "Nakit hareketi değiştirilemez kasa defterine kaydedildi.");
  }

  async function closeShift(event: FormEvent) {
    event.preventDefault();
    if (!scope || !active) return;
    const countedCashMinor = amountMinor(countedCash);
    if (!Number.isSafeInteger(countedCashMinor)) { setError("Fiziksel sayımı geçerli TL tutarı olarak girin."); return; }
    await run(async () => {
      await api(`${scope}/shifts/${encodeURIComponent(active.shift.id)}/close`, "POST", {
        requestId: crypto.randomUUID(), expectedVersion: active.shift.version,
        countedCashMinor, note: closeNote.trim() || null,
      });
      setCountedCash(""); setCloseNote("");
    }, "Vardiya kapatıldı; sayım farkı ve açıklaması saklandı.");
  }

  async function reverseMovement(event: FormEvent) {
    event.preventDefault();
    if (!scope || !correctingId) return;
    const reason = correctionReason.trim();
    if (reason.length < 3 || reason.length > 500) { setError("Düzeltme gerekçesi 3–500 karakter olmalı."); return; }
    const originalId = correctingId;
    await run(async () => {
      await api(`${scope}/movements/${encodeURIComponent(originalId)}/corrections`, "POST", {
        requestId: crypto.randomUUID(), correctionType: "reversal", correctionReason: reason,
      });
      setCorrectingId(null); setCorrectionReason("");
    }, "Ters kayıt yeni hareket olarak eklendi; orijinal kayıt değişmedi.");
  }

  const totalRecent = useMemo(() => movements.slice(0, 8), [movements]);
  const currentExpected = active?.shift.expectedCashMinor ?? 0;
  const displayView = view === "opening-closing" ? "shifts" : view;

  return <>
    <PageHeading eyebrow="KASA · POSTGRESQL" title={titleFor[view]}
      description="Tek şube için manuel nakit vardiyası. POS, kart tahsilatı ve mali muhasebe bağlantısı bu sürümde yoktur."
      action={<button className="secondary-button" onClick={() => void reload()} disabled={loading}><RefreshCw size={15} /> Yenile</button>} />
    <DemoNotice>Nakit giriş ve çıkışlarını bu ekrandan elle kaydedebilirsiniz. Başlangıç vardiyaları örnek kayıtlardır. Ödeme denemeleri kasa bakiyesini değiştirmez.</DemoNotice>
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {loading ? <div className="card empty-list">Kasa kayıtları yükleniyor…</div> : !overview?.registers.length ?
      <div className="card empty-list"><strong>Bu şube için kasa kaydı bulunamadı</strong><span>İlk sürümde demo kurulumuyla tek kasa eklenir; yeni işletme onboarding adımında kasa oluşturulmalıdır.</span></div> : <>
      <div className="inventory-toolbar"><span><Wallet size={16} /> {overview.registers[0].name} · {overview.registers[0].code}</span>
        <StatusPill tone="blue">Elle takip · POS bağlı değil</StatusPill></div>
      {displayView === "summary" && <>
        <div className="metric-grid">
          <MetricCard title="Vardiya" value={active ? "Açık" : "Kapalı"} foot={active ? `Açan: ${active.shift.openedBy}` : "Yeni vardiya açabilirsiniz"} icon={<Banknote size={18} />} />
          <MetricCard title="Beklenen nakit" value={active ? money(currentExpected) : "—"} foot="Açılış + nakit giriş − çıkış" icon={<Wallet size={18} />} />
          <MetricCard title="Vardiya girişi" value={active ? money(active.cashInMinor) : "—"} foot="Yalnızca açık vardiya" icon={<ArrowDownLeft size={18} />} />
          <MetricCard title="Vardiya çıkışı" value={active ? money(active.cashOutMinor) : "—"} foot="Yalnızca açık vardiya" icon={<ArrowUpRight size={18} />} />
        </div>
        {active ? <div className="cash-layout">
          <section className="card cash-panel"><header><div><span className="eyebrow">AÇIK VARDİYA</span><h2>Vardiya hareketleri</h2></div><StatusPill tone="green">Açık</StatusPill></header>
            <p>Başlangıç {money(active.shift.openingCashMinor)} · {dateTime(active.shift.openedAt)} · {active.movementCount} hareket</p>
            <CashMovementList items={active.recentMovements} />
          </section>
          {canWrite ? <form className="card cash-panel" onSubmit={(event) => void addMovement(event)}><span className="eyebrow">NAKİT HAREKETİ</span><h2>Giriş veya çıkış kaydet</h2>
            <label>İşlem yönü<select value={movementKind} onChange={(event) => setMovementKind(event.target.value as "manual_in" | "manual_out")}><option value="manual_in">Nakit girişi</option><option value="manual_out">Nakit çıkışı</option></select></label>
            <label>Kategori<select value={movementCategory} onChange={(event) => setMovementCategory(event.target.value)}>{movementKind === "manual_in" ? <><option value="cash_sale">Nakit satış toplamı</option><option value="other">Diğer nakit girişi</option></> : <><option value="expense">İşletme gideri</option><option value="cash_drop">Kasadan teslim</option><option value="other">Diğer nakit çıkışı</option></>}</select></label>
            <label>Tutar (TL)<input inputMode="decimal" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} placeholder="0,00" /></label>
            <label>Açıklama<input value={movementDescription} onChange={(event) => setMovementDescription(event.target.value)} placeholder="Örn. öğle vardiyası nakit satış toplamı" /></label>
            <button className="primary-button" disabled={busy}>Hareketi kaydet</button>
          </form> : <div className="card cash-panel"><strong>Kasa modülü yeni işleme kapalı</strong><p>Açık vardiya güvenle kapatılabilir; yeni hareket için modülü etkinleştirin.</p></div>}
        </div> : <form className="card cash-open-form" onSubmit={(event) => void openShift(event)}><span className="eyebrow">VARDİYA AÇILIŞI</span><h2>Yeni kasa vardiyası başlat</h2>
          <p>Kasadaki başlangıç nakdini girin. Sistem bunu ayrı, değiştirilemez açılış hareketi olarak kaydeder.</p>
          <label>Açılış nakdi (TL)<input inputMode="decimal" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="Örn. 1.000,00" /></label>
          <button className="primary-button" disabled={!canWrite || busy}>{canWrite ? "Vardiyayı aç" : "Kasa modülü kapalı"}</button>
        </form>}
        <section className="card cash-history"><header><h2>Son kasa hareketleri</h2><span>Son {totalRecent.length} kayıt</span></header><CashMovementList items={totalRecent} /></section>
      </>}
      {displayView === "movements" && <section className="card cash-history"><header><h2>Değiştirilemez kasa defteri</h2><span>{movements.length} hareket</span></header>
        <CashMovementList items={movements} onCorrect={canWrite && active ? (movement) => {
          setCorrectingId(movement.id); setCorrectionReason(""); setError("");
        } : undefined} />
        {correctingId && <form className="cash-correction-form" onSubmit={(event) => void reverseMovement(event)}>
          <div><span className="eyebrow">MANUEL DÜZELTME · TERS KAYIT</span><strong>Orijinal hareket değiştirilmeyecek</strong></div>
          <label>Gerekçe<textarea rows={3} maxLength={500} required minLength={3} value={correctionReason}
            onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Örn. yanlış tutar elle girildi" /></label>
          <div className="cash-correction-actions"><button type="button" className="secondary-button" onClick={() => setCorrectingId(null)}>Vazgeç</button>
            <button className="primary-button" disabled={busy || correctionReason.trim().length < 3}>Ters kaydı oluştur</button></div>
        </form>}
        {!active && <p className="cash-correction-hint">Düzeltme için aynı kasada yeni bir açık vardiya başlatın.</p>}
      </section>}
      {displayView === "shifts" && <div className="cash-layout cash-layout-shifts">
        <section className="card cash-history"><header><h2>Vardiya geçmişi</h2><span>{shifts.length} vardiya</span></header>
          {shifts.length ? <div className="cash-shift-list">{shifts.map((shift) => <article key={shift.id}>
            <div><StatusPill tone={shift.status === "open" ? "green" : shift.differenceMinor ? "orange" : "neutral"}>{shift.status === "open" ? "Açık vardiya" : "Kapandı"}</StatusPill><strong>{dateTime(shift.openedAt)}</strong><span>Açan {shift.openedBy}{shift.closedAt ? ` · Kapatan ${shift.closedBy ?? "—"}` : ""}</span></div>
            <div><small>Beklenen</small><b>{money(shift.expectedCashMinor ?? active?.shift.expectedCashMinor ?? shift.openingCashMinor)}</b></div>
            {shift.status === "closed" && <div><small>Sayılan · fark</small><b>{money(shift.countedCashMinor ?? 0)} · {money(shift.differenceMinor ?? 0)}</b></div>}
            {shift.closeNote && <p>{shift.closeNote}</p>}
          </article>)}</div> : <div className="empty-list">Henüz kasa vardiyası bulunmuyor.</div>}
        </section>
        {active ? <form className="card cash-panel" onSubmit={(event) => void closeShift(event)}><span className="eyebrow">VARDİYA KAPANIŞI</span><h2>Fiziksel nakit sayımı</h2>
          <p>Beklenen tutar <strong>{money(currentExpected)}</strong>. Kapanış sayımı stok hareketi yaratmaz; farkı ayrı saklar.</p>
          <label>Kasada sayılan (TL)<input inputMode="decimal" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} placeholder="0,00" /></label>
          <label>Fark açıklaması (fark varsa zorunlu)<textarea rows={3} value={closeNote} onChange={(event) => setCloseNote(event.target.value)} placeholder="Sayım farkı nedenini açıklayın" /></label>
          <button className="primary-button" disabled={busy}>Say ve vardiyayı kapat</button>
        </form> : <form className="card cash-open-form" onSubmit={(event) => void openShift(event)}><span className="eyebrow">VARDİYA AÇILIŞI</span><h2>Yeni kasa vardiyası başlat</h2>
          <p>Kasadaki başlangıç nakdini girin. Açılış nakdi ayrı ve değiştirilemez bir hareket olarak kaydedilir.</p>
          <label>Açılış nakdi (TL)<input inputMode="decimal" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="Örn. 1.000,00" /></label>
          <button className="primary-button" disabled={!canWrite || busy}>{canWrite ? "Vardiyayı aç" : "Kasa modülü kapalı"}</button>
        </form>}
      </div>}
    </>}
  </>;
}

function CashMovementList({ items, onCorrect }: { items: Movement[]; onCorrect?: (movement: Movement) => void }) {
  if (!items.length) return <div className="empty-list">Henüz kasa hareketi yok.</div>;
  return <div className="cash-movement-list">{items.map((item) => <article key={item.id}>
    <span className={`cash-movement-icon ${item.kind === "manual_out" ? "out" : "in"}`}>{item.kind === "manual_out" ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}</span>
    <div><strong>{item.correctionType === "reversal" ? "Ters kayıt düzeltmesi" : movementTitle(item)}</strong>
      <span>{item.correctionType === "reversal" ? item.correctionReason : item.description}</span>
      <small>{dateTime(item.createdAt)} · {item.actor} · Elle girildi{item.originalMovementId ? ` · Orijinal: ${item.originalMovementId.slice(0, 8)}` : ""}</small></div>
    <b className={item.kind === "manual_out" ? "cash-negative" : "cash-positive"}>{item.kind === "manual_out" ? "−" : "+"}{money(item.amountMinor)}</b>
    {onCorrect && item.source === "manual" && !item.originalMovementId &&
      (item.kind === "manual_in" || item.kind === "manual_out") && <button className="secondary-button cash-reverse-button"
        onClick={() => onCorrect(item)} aria-label={`${movementTitle(item)} hareketini düzelt`}><RotateCcw size={14} /> Düzelt</button>}
  </article>)}</div>;
}
