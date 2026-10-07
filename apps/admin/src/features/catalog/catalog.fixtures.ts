import type { Money, ProductStatus, SalesChannel } from "./contracts";

export const catalogIds = {
  singleFirm: "11111111-1111-4111-8111-111111111111",
  singleBranch: "33333333-3333-4333-8333-333333333333",
  multiFirm: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  brand: "22222222-2222-4222-8222-222222222222",
  moda: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  besiktas: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  atasehir: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
} as const;

export type CatalogProductRecord = {
  id: string;
  firmId: string;
  brandId: string | null;
  branchIds: string[];
  name: string;
  sku: string;
  category: { id: string; name: string };
  status: ProductStatus;
  channels: SalesChannel[];
  image: string;
  recipeLinked: boolean;
  basePrice: Money;
  branchPrices: Record<string, Money>;
  description: string;
  allergens: string[];
  optionGroups: string[];
  updatedAt: string;
  version: number;
};

const seed = [
  {
    name: "Margherita Pizza",
    sku: "PZZ-001",
    category: { id: "pizza", name: "Pizzalar" },
    status: "published",
    channels: ["pos", "qr", "delivery"],
    image: "🍕",
    recipeLinked: true,
    amountMinor: 32000,
    description: "Domates sosu, mozzarella ve fesleğen.",
    allergens: ["Gluten", "Süt"],
    optionGroups: ["Boyut", "Ek malzeme"],
  },
  {
    name: "Karışık Pizza",
    sku: "PZZ-002",
    category: { id: "pizza", name: "Pizzalar" },
    status: "published",
    channels: ["pos", "qr", "delivery"],
    image: "🍕",
    recipeLinked: true,
    amountMinor: 41000,
    description: "Karışık malzemeli pizza.",
    allergens: ["Gluten", "Süt"],
    optionGroups: ["Boyut"],
  },
  {
    name: "Serpme Kahvaltı",
    sku: "KHV-001",
    category: { id: "breakfast", name: "Kahvaltı" },
    status: "published",
    channels: ["pos", "qr"],
    image: "🥐",
    recipeLinked: true,
    amountMinor: 69000,
    description: "Paylaşımlı kahvaltı tabağı.",
    allergens: ["Gluten", "Süt", "Yumurta"],
    optionGroups: [],
  },
  {
    name: "Menemen",
    sku: "KHV-003",
    category: { id: "breakfast", name: "Kahvaltı" },
    status: "published",
    channels: ["pos", "qr"],
    image: "🍳",
    recipeLinked: true,
    amountMinor: 24500,
    description: "Domates ve biberle hazırlanan menemen.",
    allergens: ["Yumurta"],
    optionGroups: [],
  },
  {
    name: "Ev Yapımı Limonata",
    sku: "ICK-008",
    category: { id: "drinks", name: "İçecekler" },
    status: "published",
    channels: ["pos", "qr", "delivery"],
    image: "🍋",
    recipeLinked: false,
    amountMinor: 12500,
    description: "Ev yapımı limonata.",
    allergens: [],
    optionGroups: [],
  },
  {
    name: "San Sebastian Cheesecake",
    sku: "TTL-012",
    category: { id: "dessert", name: "Tatlılar" },
    status: "draft",
    channels: ["pos"],
    image: "🍰",
    recipeLinked: false,
    amountMinor: 22000,
    description: "Fırınlanmış cheesecake.",
    allergens: ["Süt", "Yumurta"],
    optionGroups: [],
  },
] as const satisfies ReadonlyArray<{
  name: string;
  sku: string;
  category: { id: string; name: string };
  status: ProductStatus;
  channels: readonly SalesChannel[];
  image: string;
  recipeLinked: boolean;
  amountMinor: number;
  description: string;
  allergens: readonly string[];
  optionGroups: readonly string[];
}>;

const singleProductIds = [
  "55555555-5555-4555-8555-555555555501",
  "55555555-5555-4555-8555-555555555502",
  "55555555-5555-4555-8555-555555555503",
  "55555555-5555-4555-8555-555555555504",
  "55555555-5555-4555-8555-555555555505",
  "55555555-5555-4555-8555-555555555506",
];

const multiProductIds = [
  "66666666-6666-4666-8666-666666666601",
  "66666666-6666-4666-8666-666666666602",
  "66666666-6666-4666-8666-666666666603",
  "66666666-6666-4666-8666-666666666604",
  "66666666-6666-4666-8666-666666666605",
  "66666666-6666-4666-8666-666666666606",
];

export const catalogRecords: CatalogProductRecord[] = [
  ...seed.map((item, index) => ({
    ...item,
    id: singleProductIds[index],
    firmId: catalogIds.singleFirm,
    brandId: null,
    branchIds: [catalogIds.singleBranch],
    channels: [...item.channels],
    allergens: [...item.allergens],
    optionGroups: [...item.optionGroups],
    basePrice: { amountMinor: item.amountMinor, currency: "TRY" as const },
    branchPrices: {},
    updatedAt: "2026-10-05T09:30:00Z",
    version: 1,
  })),
  ...seed.map((item, index) => ({
    ...item,
    id: multiProductIds[index],
    firmId: catalogIds.multiFirm,
    brandId: catalogIds.brand,
    branchIds:
      index === 5
        ? [catalogIds.moda]
        : [catalogIds.moda, catalogIds.besiktas, catalogIds.atasehir],
    channels: [...item.channels],
    allergens: [...item.allergens],
    optionGroups: [...item.optionGroups],
    basePrice: { amountMinor: item.amountMinor, currency: "TRY" as const },
    branchPrices: (index === 0
      ? {
          [catalogIds.besiktas]: {
            amountMinor: 34000,
            currency: "TRY" as const,
          },
        }
      : {}) as Record<string, Money>,
    updatedAt: "2026-10-05T09:30:00Z",
    version: 1,
  })),
];
