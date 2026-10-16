import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ReceiptText } from "lucide-react";
import type { ViewContext } from "../../app/context";
import { PageHeading, StatusPill } from "../../shared/ui";

type Category = { id: string; name: string; isActive: boolean };
type Expense = { id: string; categoryId: string; categoryName: string; expenseDate: string;
  amountMinor: number; currency: "TRY"; description: string; source: "manual"; actor: string; createdAt: string };
type ListResponse = { items: Expense[]; pageInfo: { page: number; pageSize: number; totalItems: number; totalPages: number } };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180";
const todayIstanbul = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const money = (minor: number) => new Intl.NumberFormat("tr-TR", {
  style: "currency", currency: "TRY", minimumFractionDigits: 2,
}).format(minor / 100);
const dateLabel = (date: string) => new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium", timeZone: "UTC",
}).format(new Date(`${date}T00:00:00Z`));

async function api<T>(path: string, actor: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("Gider API'sine bağlanılamadı. Yerel API'nin çalıştığını kontrol edin.");
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { error?: { message?: string }; detail?: string };
    throw new Error(problem.error?.message ?? problem.detail ?? `Gider işlemi başarısız (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function ExpenseManagementPage({ ctx, canWrite, view = "expenses" }: {
  ctx: ViewContext; canWrite: boolean; view?: "expenses" | "categories";
}) {
  const scope = ctx.branchApiId
    ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}`
    : null;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Expense[]>([]);
  const [selected, setSelected] = useState<Expense | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIstanbul);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [from, setFrom] = useState(() => `${todayIstanbul().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayIstanbul);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<ListResponse["pageInfo"] | null>(null);

  const reload = useCallback(async () => {
    if (!scope) { setCategories([]); setItems([]); setSelected(null); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const categoryResult = await api<{ items: Category[] }>(`${scope}/expense-categories`, actor);
      setCategories(categoryResult.items);
      if (categoryResult.items.length) setCategoryId(current =>
        categoryResult.items.some(item => item.id === current) ? current : categoryResult.items[0].id);
      if (view === "categories") {
        setItems([]); setPageInfo(null); setSelected(null);
      } else {
        const params = new URLSearchParams({ from, to, page: String(page), pageSize: "50" });
        const result = await api<ListResponse>(`${scope}/expenses?${params}`, actor);
        setItems(result.items); setPageInfo(result.pageInfo);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Giderler yüklenemedi.");
    } finally { setLoading(false); }
  }, [scope, view, from, to, page, actor]);

  useEffect(() => { void reload(); }, [reload]);

  const showDetail = async (id: string) => {
    if (!scope) return;
    setError("");
    try {
      const result = await api<{ expense: Expense }>(`${scope}/expenses/${encodeURIComponent(id)}`, actor);
      setSelected(result.expense);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gider detayı yüklenemedi.");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scope || !canWrite) return;
    const rawAmount = amount.trim();
    const normalizedAmount = rawAmount.includes(",")
      ? rawAmount.replaceAll(".", "").replace(",", ".")
      : /^\d{1,3}(\.\d{3})+$/.test(rawAmount) ? rawAmount.replaceAll(".", "") : rawAmount;
    const parsedAmount = Number(normalizedAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || Math.round(parsedAmount * 100) !== parsedAmount * 100) {
      setError("Tutar pozitif olmalı ve en fazla iki ondalık basamak içermelidir."); return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const requestId = crypto.randomUUID();
      const result = await api<{ expense: Expense }>(`${scope}/expenses`, actor, "POST", {
        requestId, categoryId, expenseDate, amountMinor: Math.round(parsedAmount * 100), description,
      });
      setSelected(result.expense); setAmount(""); setDescription("");
      setPage(1);
      setNotice("Gider kaydedildi. Bu kayıt kasa ve cari bakiyesini değiştirmez.");
      await reload();
      setSelected(result.expense);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gider kaydedilemedi.");
    } finally { setBusy(false); }
  };

  return <section className="expense-page">
    <PageHeading eyebrow="FİNANS · MANUEL KAYIT" title={view === "categories" ? "Gider kategorileri" : "Giderler"}
      description={view === "categories" ? "Bu firmada kullanılabilir gider kategorileri." : "Şube kapsamında kaydedilen manuel giderler."} />
    {!scope && <div className="notice" role="status">Giderleri görmek için önce tek bir şube seçin.</div>}
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {view === "categories" ? <div className="card expense-categories">
      <h2>Kullanılabilir kategoriler</h2>
      {loading ? <p>Yükleniyor…</p> : categories.length ? categories.map((category) =>
        <div key={category.id}><span>{category.name}</span><StatusPill tone={category.isActive ? "green" : "orange"}>{category.isActive ? "Aktif" : "Pasif"}</StatusPill></div>)
        : <p>Henüz kategori bulunmuyor.</p>}
    </div> : <>
      <div className="expense-layout">
        <form className="card expense-form" onSubmit={submit}>
          <div className="expense-form-heading"><ReceiptText size={19} /><div><h2>Yeni gider</h2><p>İlk sürümde yalnızca manuel kayıt alınır.</p></div></div>
          <label>Kategori<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={!canWrite || !categories.length}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></label>
          <label>Gider tarihi<input type="date" required value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} disabled={!canWrite} /></label>
          <label>Tutar (TRY)<input inputMode="decimal" required placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={!canWrite} /></label>
          <label>Açıklama<textarea required minLength={1} maxLength={500} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canWrite} /></label>
          <small>Kaynak: Manuel · Kayıtlar silinemez veya düzenlenemez. İptal/düzeltme sonraki sürümdedir.</small>
          <button className="primary-button" type="submit" disabled={!canWrite || busy || loading || !categories.length}>
            {busy ? "Kaydediliyor…" : canWrite ? "Gideri kaydet" : "Modül kapalı · yeni gider eklenemez"}
          </button>
        </form>
        <div className="card expense-list-card">
          <div className="expense-list-heading"><div><h2>Gider kayıtları</h2><p>{pageInfo?.totalItems ?? 0} kayıt · seçili şubeye ait</p></div>
            {selected && <button className="secondary-button" onClick={() => setSelected(null)}><ArrowLeft size={15} /> Listeye dön</button>}
          </div>
          <div className="expense-filters">
            <label>Başlangıç<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
            <label>Bitiş<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
          </div>
          {selected ? <article className="expense-detail">
            <span className="expense-detail-category">{selected.categoryName}</span><h3>{money(selected.amountMinor)}</h3>
            <dl><div><dt>Gider tarihi</dt><dd>{dateLabel(selected.expenseDate)}</dd></div>
              <div><dt>Açıklama</dt><dd>{selected.description}</dd></div>
              <div><dt>Kaynak</dt><dd>Manuel</dd></div><div><dt>Şube</dt><dd>{ctx.selectedBranch?.name}</dd></div>
              <div><dt>Kaydeden</dt><dd>{selected.actor}</dd></div><div><dt>Kayıt zamanı</dt><dd>{new Date(selected.createdAt).toLocaleString("tr-TR")}</dd></div>
              <div><dt>Gider no</dt><dd>{selected.id}</dd></div></dl>
            <p className="expense-detail-note">Bu kayıt kasa, cari veya muhasebe fişine bağlı değildir.</p>
          </article> : loading ? <p className="expense-empty">Giderler yükleniyor…</p> : items.length ? <div className="expense-list">
            {items.map((expense) => <button key={expense.id} className="expense-row" onClick={() => void showDetail(expense.id)}>
              <span className="expense-row-date">{dateLabel(expense.expenseDate)}</span>
              <span className="expense-row-main"><strong>{expense.categoryName}</strong><small>{expense.description} · {expense.actor}</small></span>
              <b>{money(expense.amountMinor)}</b>
            </button>)}
          </div> : <p className="expense-empty">Bu tarih aralığında gider kaydı yok.</p>}
          {!selected && (pageInfo?.totalPages ?? 0) > 1 && <div className="expense-pagination">
            <button className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Önceki</button>
            <span>Sayfa {pageInfo?.page} / {pageInfo?.totalPages} · {pageInfo?.totalItems} kayıt</span>
            <button className="secondary-button" disabled={page >= (pageInfo?.totalPages ?? 1) || loading} onClick={() => setPage(value => value + 1)}>Sonraki</button>
          </div>}
        </div>
      </div>
      <div className="notice expense-scope-notice" role="note">Gider kaydı ayrı saklanır; kasa hareketi, cari hareketi veya muhasebe fişi yaratmaz.</div>
    </>}
  </section>;
}
