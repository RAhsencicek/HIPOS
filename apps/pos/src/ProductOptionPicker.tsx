import { useEffect, useRef, useState } from "react";

export type SelectedOption = { groupId: string; optionId: string; quantity: number; groupName: string; optionName: string; priceDeltaMinor: number };
export type OptionSelection = { valid: boolean; items: SelectedOption[]; unitPriceMinor: number };
type Item = { id: string; name: string; priceDeltaMinor: number; quantityEnabled: boolean; maxQuantity: number };
type Group = { groupId: string; name: string; minSelections: number; maxSelections: number | null; items: Item[] };
const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);

export function ProductOptionPicker({ firmId, branchId, actor, productId, basePriceMinor, initial = [], onChange }: {
  firmId: string; branchId: string; actor: string; productId: string; basePriceMinor: number;
  initial?: SelectedOption[]; onChange: (value: OptionSelection) => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>(() => Object.fromEntries(initial.map(item => [item.optionId, item.quantity])));
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const callback = useRef(onChange); callback.current = onChange;
  useEffect(() => {
    const controller = new AbortController(); setGroups(null); setError("");
    const path = `/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/catalog/products/${encodeURIComponent(productId)}/option-groups`;
    void fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, { headers: { "X-Demo-Actor": actor }, signal: controller.signal })
      .then(async response => { if (!response.ok) { const body = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(body.detail ?? "Seçenekler alınamadı."); } return response.json() as Promise<{ items: Group[] }>; })
      .then(result => setGroups(result.items)).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Seçenekler alınamadı."); });
    return () => controller.abort();
  }, [firmId, branchId, actor, productId, reload]);
  useEffect(() => {
    const items = (groups ?? []).flatMap(group => group.items.filter(item => (selected[item.id] ?? 0) > 0).map(item => ({ groupId: group.groupId, optionId: item.id, quantity: selected[item.id], groupName: group.name, optionName: item.name, priceDeltaMinor: item.priceDeltaMinor })));
    const unitPriceMinor = basePriceMinor + items.reduce((sum, item) => sum + item.priceDeltaMinor * item.quantity, 0);
    const retained = Object.entries(selected).every(([id, quantity]) => quantity <= 0 || items.some(item => item.optionId === id));
    const valid = Boolean(groups) && !error && retained && unitPriceMinor >= 0 && groups!.every(group => {
      const chosen = group.items.filter(item => (selected[item.id] ?? 0) > 0);
      return chosen.length >= group.minSelections && (group.maxSelections === null || chosen.length <= group.maxSelections) && chosen.every(item => Number.isInteger(selected[item.id]) && selected[item.id] <= (item.quantityEnabled ? item.maxQuantity : 1));
    });
    callback.current({ valid, items, unitPriceMinor });
  }, [groups, selected, error, basePriceMinor]);
  return <div className="product-option-picker" aria-label="Ürün seçenekleri">
    {error && <p role="alert">{error} <button type="button" onClick={() => setReload(value => value + 1)}>Tekrar dene</button></p>}
    {!groups && !error && <p role="status">Seçenekler yükleniyor…</p>}
    {groups && Object.entries(selected).some(([id, quantity]) => quantity > 0 && !groups.some(group => group.items.some(item => item.id === id))) && <p role="alert">Önceki seçenek artık bulunmuyor. <button type="button" onClick={() => setSelected({})}>Seçimleri temizle</button></p>}
    {groups && basePriceMinor + groups.flatMap(group => group.items).reduce((sum, item) => sum + item.priceDeltaMinor * (selected[item.id] ?? 0), 0) < 0 && <p role="alert">Seçeneklerle birlikte ürün fiyatı sıfırın altına düşemez.</p>}
    {groups?.map(group => { const count = group.items.filter(item => (selected[item.id] ?? 0) > 0).length; return <fieldset key={group.groupId}><legend>{group.name}</legend><small>{group.minSelections ? `En az ${group.minSelections} seçim` : "İsteğe bağlı"}{group.maxSelections !== null ? ` · En fazla ${group.maxSelections} seçim` : ""}</small><div className="product-option-choices">{group.items.map(item => { const quantity = selected[item.id] ?? 0; return <div className="product-option-choice" key={item.id}><label><input type="checkbox" checked={quantity > 0} disabled={!quantity && group.maxSelections !== null && count >= group.maxSelections} onChange={event => setSelected(current => ({ ...current, [item.id]: event.target.checked ? 1 : 0 }))} /><span>{item.name} {item.priceDeltaMinor !== 0 && <small>{item.priceDeltaMinor > 0 ? "+" : "−"}{money(Math.abs(item.priceDeltaMinor))}</small>}</span></label>{quantity > 0 && item.quantityEnabled && <label>Adet <input type="number" inputMode="numeric" min="1" max={item.maxQuantity} step="1" value={quantity} onChange={event => setSelected(current => ({ ...current, [item.id]: Math.max(1, Math.min(item.maxQuantity, Math.floor(Number(event.target.value) || 1))) }))} /></label>}</div>; })}</div>{count < group.minSelections && <small className="product-option-validation">En az {group.minSelections} seçenek seçin.</small>}</fieldset>; })}
  </div>;
}
