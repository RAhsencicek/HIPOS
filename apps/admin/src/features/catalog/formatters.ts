import type { Money, SalesChannel } from "./contracts";

export function formatCatalogMoney(money: Money): string {
  if (!Number.isSafeInteger(money.amountMinor)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(money.amountMinor / 100);
}

export const channelLabels: Record<SalesChannel, string> = {
  pos: "POS",
  qr: "QR",
  delivery: "Paket",
};
