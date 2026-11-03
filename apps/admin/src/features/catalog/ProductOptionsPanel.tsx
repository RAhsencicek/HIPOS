import { useEffect, useState, type FormEvent } from "react";
import { useCatalogProvider } from "../../app/providers";
import { CatalogProviderError } from "./contracts";
import type { CatalogOptionGroup, CatalogOptionItem, CatalogScope, ProductOptionGroups, ProductOptionInput } from "./contracts";
import { formatCatalogMoney } from "./formatters";
import { PageHeading } from "../../shared/ui";

type Selection = { selected: boolean; min: string; max: string };
type Retry = { action: () => Promise<void>; refreshProduct: boolean };

function parseDelta(value: string): number | null {
  const match = /^(-?)(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(value.trim().replace(",", "."));
  if (!match) return null;
  const amount = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return amount <= 1_000_000_000 ? (match[1] ? -amount : amount) : null;
}

function deltaText(value: number) {
  return (value / 100).toFixed(2).replace(".", ",");
}

export function ProductOptionsPanel({ scope, productId, canManage, onChanged }: {
  scope: CatalogScope; productId: string; canManage: boolean; onChanged: () => void;
}) {
  const { provider } = useCatalogProvider();
  const [groups, setGroups] = useState<CatalogOptionGroup[]>([]);
  const [links, setLinks] = useState<ProductOptionGroups | null>(null);
  const [selection, setSelection] = useState<Record<string, Selection>>({});
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState<Retry | null>(null);
  const [groupName, setGroupName] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true); setError(""); setConflict(false);
    Promise.all([provider.listOptionGroups(scope), provider.listProductOptionGroups({ scope, productId })])
      .then(([all, attached]) => {
        if (!current) return;
        setGroups(all); setLinks(attached);
        setSelection(Object.fromEntries(attached.items.map(item => [item.groupId,
          { selected: true, min: String(item.minSelections), max: item.maxSelections === null ? "" : String(item.maxSelections) }])));
      }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : "Seçenekler yüklenemedi."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [provider, scope.firmId, scope.branchId, productId, reload]);

  async function run(operation: Retry) {
    if (busy) return;
    setBusy(true); setError(""); setConflict(false); setNotice("");
    try {
      await operation.action();
      setRetry(null);
      if (operation.refreshProduct) { onChanged(); return; }
      setGroups(await provider.listOptionGroups(scope));
      setNotice("Seçenek bilgileri kaydedildi.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "İşlem tamamlanamadı.");
      setConflict(reason instanceof CatalogProviderError && reason.code === "VERSION_CONFLICT");
      setRetry(reason instanceof CatalogProviderError && reason.code === "LOAD_FAILED" ? operation : null);
    } finally { setBusy(false); }
  }

  function addGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    const input = { requestId: crypto.randomUUID(), name, isActive: true,
      sortOrder: Math.max(-1, ...groups.map(group => group.sortOrder)) + 1 };
    void run({ refreshProduct: false, action: async () => { await provider.createOptionGroup(scope, input); setGroupName(""); } });
  }

  function saveLinks() {
    if (!links) return;
    const items: ProductOptionInput[] = [];
    const previousOrder = new Map(links.items.map((item, index) => [item.groupId, index]));
    const orderedGroups = [...groups].sort((a, b) =>
      (previousOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (previousOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    for (const group of orderedGroups) {
      const value = selection[group.id];
      if (!value?.selected) continue;
      if (!/^\d+$/.test(value.min) || (value.max !== "" && !/^\d+$/.test(value.max))) {
        setError("Seçim sınırları sıfır veya daha büyük tam sayı olmalı."); return;
      }
      const min = Number(value.min), max = value.max === "" ? null : Number(value.max);
      if (!Number.isSafeInteger(min) || (max !== null && (!Number.isSafeInteger(max) || max < min)) || min > group.items.length) {
        setError(`“${group.name}” için seçim sınırlarını ve seçenek sayısını kontrol edin.`); return;
      }
      items.push({ groupId: group.id, minSelections: min, maxSelections: max, sortOrder: items.length });
    }
    const request = { scope, productId, requestId: crypto.randomUUID(), expectedVersion: links.productVersion, items };
    void run({ refreshProduct: true, action: async () => { await provider.saveProductOptionGroups(request); } });
  }

  const locked = !canManage || busy || Boolean(retry);
  const changed = links !== null && groups.some(group => {
    const current = selection[group.id];
    const original = links.items.find(item => item.groupId === group.id);
    return Boolean(current?.selected) !== Boolean(original) || Boolean(current?.selected && original &&
      (current.min !== String(original.minSelections) || current.max !== (original.maxSelections === null ? "" : String(original.maxSelections))));
  });
  return <section className="card detail-card product-options" aria-label="Ürün seçenekleri">
    <span className="card-kicker">ÜRÜN SEÇENEKLERİ</span><h2>Seçenek grupları</h2>
    <p>Gruplar birden fazla üründe kullanılabilir. Seçim sınırları bu ürün için kaydedilir.</p>
    <div className="notice" role="status">Ürüne bağlanan seçenekler garson ve test satış ekranlarında seçilebilir.</div>
    {loading && <p role="status">Seçenekler yükleniyor…</p>}
    {error && <div className="notice" role="alert">{error}{retry && <button type="button" className="soft-button" disabled={busy} onClick={() => void run(retry)}>Aynı işlemi tekrar dene</button>}</div>}
    {conflict && <button type="button" className="soft-button" onClick={onChanged}>Güncel ürün bilgilerini yükle</button>}
    {!loading && error && !links && <button type="button" className="soft-button" onClick={() => setReload(value => value + 1)}>Tekrar dene</button>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {!loading && links && <>
      {!canManage && <p>Seçenekleri değiştirmek için ürün yönetimi bu şubede etkin olmalı.</p>}
      <form onSubmit={addGroup} className="product-option-create">
        <label className="draft-field"><span>Yeni grup adı</span><input value={groupName} disabled={locked} maxLength={100}
          onChange={event => setGroupName(event.target.value)} placeholder="Örn. Ekstralar" /></label>
        <button className="soft-button" type="submit" disabled={locked || !groupName.trim()}>Grup oluştur</button>
      </form>
      {!groups.length && <p>Henüz seçenek grubu yok. İsterseniz bir grup oluşturup bu ürüne bağlayabilirsiniz.</p>}
      {groups.map(group => {
        const current = selection[group.id] ?? { selected: false, min: "0", max: "" };
        const update = (patch: Partial<Selection>) => setSelection(previous => ({ ...previous, [group.id]: { ...current, ...patch } }));
        return <div className="product-option-group" key={group.id}>
          <div className="product-option-heading"><label><input type="checkbox" checked={current.selected} disabled={locked}
            onChange={event => update({ selected: event.target.checked })} /> <strong>{group.name}</strong></label>
            <small>{group.items.length} seçenek · {group.isActive ? "Aktif" : "Pasif"}</small></div>
          {current.selected && <div className="product-option-limits">
            <label>En az seçim<input type="number" min="0" step="1" value={current.min} disabled={locked} onChange={event => update({ min: event.target.value })} /></label>
            <label>En çok seçim<input type="number" min="0" step="1" placeholder="Sınır yok" value={current.max} disabled={locked} onChange={event => update({ max: event.target.value })} /></label>
          </div>}
          <OptionGroupEditor key={`${group.id}:${group.version}`} group={group} disabled={locked}
            onGroupSave={(name, isActive) => {
              const input = { requestId: crypto.randomUUID(), name, isActive, sortOrder: group.sortOrder, expectedVersion: group.version };
              void run({ refreshProduct: false, action: async () => { await provider.updateOptionGroup(scope, group.id, input); } });
            }}
            onItemSave={(item, name, priceDeltaMinor, quantityEnabled, maxQuantity, isActive) => {
              const input = { requestId: crypto.randomUUID(), name, priceDeltaMinor, quantityEnabled, maxQuantity, isActive,
                sortOrder: item?.sortOrder ?? Math.max(-1, ...group.items.map(value => value.sortOrder)) + 1, expectedVersion: group.version };
              void run({ refreshProduct: false, action: async () => {
                if (item) await provider.updateOptionItem(scope, group.id, item.id, input);
                else await provider.createOptionItem(scope, group.id, input);
              } });
            }} />
        </div>;
      })}
      <p className="product-option-hint">Pasif grup ve seçenekler mevcut sipariş kuralına göre yine seçilebilir. Adetli seçeneklerde fiyat farkı seçilen adetle çarpılır.</p>
      <button className="primary-button" type="button" disabled={locked || !changed} onClick={saveLinks}>Ürün seçeneklerini kaydet</button>
    </>}
  </section>;
}

export function OptionGroupsPage({ scope, canManage }: { scope: CatalogScope; canManage: boolean }) {
  const { provider, source } = useCatalogProvider();
  const [groups, setGroups] = useState<CatalogOptionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState<(() => Promise<unknown>) | null>(null);
  useEffect(() => {
    let current = true;
    if (source !== "http" || !scope.branchId) { setLoading(false); setGroups([]); return () => { current = false; }; }
    setLoading(true); setError("");
    provider.listOptionGroups(scope).then(items => { if (current) setGroups(items); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Seçenek grupları yüklenemedi."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [provider, source, scope.firmId, scope.branchId, revision]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); setRetry(null); setNotice("Seçenek grubu kaydedildi."); setRevision(value => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "İşlem tamamlanamadı."); setRetry(reason instanceof CatalogProviderError && reason.code === "LOAD_FAILED" ? () => action : null); }
    finally { setBusy(false); }
  }
  const disabled = !canManage || busy || Boolean(retry);
  return <><PageHeading eyebrow="ÜRÜNLER VE MENÜ" title="Seçenek Grupları" description="Ürünlerde tekrar kullanılacak seçenek gruplarını ve fiyat farklarını yönetin." />
    {!scope.branchId && <div className="notice">Önce bir şube seçin.</div>}
    {source !== "http" && <div className="notice">Seçenek gruplarını yönetmek için katalog bağlantısı gerekir.</div>}
    {loading && <p role="status">Seçenek grupları yükleniyor…</p>}
    {error && <div className="notice" role="alert">{error}{retry ? <button type="button" disabled={busy} onClick={() => void run(retry)}>Aynı işlemi tekrar dene</button> : <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Yenile</button>}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {source === "http" && scope.branchId && <section className="card detail-card product-options"><p>Gruplar firma genelindedir. Bir gruptaki değişiklik onu kullanan tüm ürünleri etkiler. Ürüne bağlama ve seçim sınırları ürün ayrıntısından yapılır.</p>
      {!canManage && <p>Yeni işlem için ürün yönetimi etkin olmalı.</p>}
      <form className="product-option-create" onSubmit={event => { event.preventDefault(); if (!name.trim() || disabled) return; const input = { requestId: crypto.randomUUID(), name: name.trim(), isActive: true, sortOrder: Math.max(-1, ...groups.map(group => group.sortOrder)) + 1 }; void run(async () => { await provider.createOptionGroup(scope, input); setName(""); }); }}><label className="draft-field"><span>Yeni grup adı</span><input value={name} maxLength={100} disabled={disabled} onChange={event => setName(event.target.value)} placeholder="Örn. Boyut" /></label><button className="soft-button" disabled={disabled || !name.trim()}>Grup oluştur</button></form>
      {!loading && !groups.length && !error && <p>Henüz seçenek grubu yok.</p>}
      {groups.map(group => <div className="product-option-group" key={group.id}><div className="product-option-heading"><strong>{group.name}</strong><small>{group.items.length} seçenek · {group.isActive ? "Aktif" : "Pasif"}</small></div><OptionGroupEditor key={`${group.id}:${group.version}`} group={group} disabled={disabled}
        onGroupSave={(groupName, isActive) => { const input = { requestId: crypto.randomUUID(), name: groupName, isActive, sortOrder: group.sortOrder, expectedVersion: group.version }; void run(() => provider.updateOptionGroup(scope, group.id, input)); }}
        onItemSave={(item, itemName, priceDeltaMinor, quantityEnabled, maxQuantity, isActive) => { const input = { requestId: crypto.randomUUID(), name: itemName, priceDeltaMinor, quantityEnabled, maxQuantity, isActive, sortOrder: item?.sortOrder ?? Math.max(-1, ...group.items.map(value => value.sortOrder)) + 1, expectedVersion: group.version }; void run(() => item ? provider.updateOptionItem(scope, group.id, item.id, input) : provider.createOptionItem(scope, group.id, input)); }} /></div>)}
      <p className="product-option-hint">Pasif grup ve seçenekler mevcut sözleşmeye göre siparişte seçilebilir.</p></section>}
  </>;
}

function OptionGroupEditor({ group, disabled, onGroupSave, onItemSave }: {
  group: CatalogOptionGroup; disabled: boolean;
  onGroupSave: (name: string, isActive: boolean) => void;
  onItemSave: (item: CatalogOptionItem | null, name: string, price: number, quantityEnabled: boolean, maxQuantity: number, isActive: boolean) => void;
}) {
  const [name, setName] = useState(group.name);
  const [active, setActive] = useState(group.isActive);
  const [itemId, setItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [delta, setDelta] = useState("0");
  const [quantityEnabled, setQuantityEnabled] = useState(false);
  const [maxQuantity, setMaxQuantity] = useState("1");
  const [itemActive, setItemActive] = useState(true);
  const [error, setError] = useState("");
  function selectItem(id: string) {
    const item = group.items.find(value => value.id === id);
    setItemId(id); setItemName(item?.name ?? ""); setDelta(item ? deltaText(item.priceDeltaMinor) : "0");
    setQuantityEnabled(item?.quantityEnabled ?? false); setMaxQuantity(String(item?.maxQuantity ?? 1)); setItemActive(item?.isActive ?? true); setError("");
  }
  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = parseDelta(delta);
    const max = quantityEnabled && /^\d+$/.test(maxQuantity) ? Number(maxQuantity) : quantityEnabled ? 0 : 1;
    if (!itemName.trim() || price === null || !Number.isSafeInteger(max) || max < 1 || max > 2147483647) {
      setError("Seçenek adını, fiyat farkını ve adet sınırını kontrol edin."); return;
    }
    setError(""); onItemSave(group.items.find(item => item.id === itemId) ?? null, itemName.trim(), price, quantityEnabled, max, itemActive);
  }
  return <details className="product-option-editor"><summary>Grup ve seçenekleri düzenle</summary>
    <p>Bu grupta yapılan değişiklikler, grubu kullanan diğer ürünlere de yansır.</p>
    <form className="product-option-fields" onSubmit={event => { event.preventDefault(); if (name.trim()) onGroupSave(name.trim(), active); }}>
      <label>Grup adı<input value={name} maxLength={100} disabled={disabled} onChange={event => setName(event.target.value)} required /></label>
      <label className="product-option-check"><input type="checkbox" checked={active} disabled={disabled} onChange={event => setActive(event.target.checked)} /> Grup aktif</label>
      <button className="soft-button" disabled={disabled || !name.trim()}>Grubu kaydet</button>
    </form>
    <div className="product-option-items">{group.items.map(item => <button type="button" className="soft-button" key={item.id} disabled={disabled} onClick={() => selectItem(item.id)}>
      {item.name} · {formatCatalogMoney({ amountMinor: item.priceDeltaMinor, currency: "TRY" })} {item.isActive ? "" : "· Pasif"}
    </button>)}</div>
    <form className="product-option-fields" onSubmit={submitItem}>
      <strong>{itemId ? "Seçeneği düzenle" : "Yeni seçenek"}</strong>
      <label>Seçenek adı<input value={itemName} maxLength={100} disabled={disabled} onChange={event => setItemName(event.target.value)} required /></label>
      <label>Fiyat farkı (TL)<input inputMode="decimal" value={delta} disabled={disabled} onChange={event => setDelta(event.target.value)} required /></label>
      <label className="product-option-check"><input type="checkbox" checked={quantityEnabled} disabled={disabled} onChange={event => setQuantityEnabled(event.target.checked)} /> Adet seçilebilir</label>
      {quantityEnabled && <label>En yüksek adet<input type="number" min="1" step="1" value={maxQuantity} disabled={disabled} onChange={event => setMaxQuantity(event.target.value)} required /></label>}
      <label className="product-option-check"><input type="checkbox" checked={itemActive} disabled={disabled} onChange={event => setItemActive(event.target.checked)} /> Seçenek aktif</label>
      {error && <span role="alert">{error}</span>}
      <button className="soft-button" disabled={disabled}>{itemId ? "Seçeneği kaydet" : "Seçenek ekle"}</button>
      {itemId && <button type="button" className="soft-button" disabled={disabled} onClick={() => selectItem("")}>Yeni seçenek</button>}
    </form>
  </details>;
}
