export interface CoinPackage {
  id: string;
  coins: number;
  price: number;
  currency: "INR";
  displayPrice: string;
  originalPrice?: number;
  discount?: string;
  popular: boolean;
  /** Bottom / hero pack badge (e.g. "Most Value"). */
  mostValue: boolean;
  sortOrder: number;
}

type CoinPackageInput = {
  id: string;
  coins: number;
  price: number;
  currency?: "INR";
  displayPrice?: string;
  originalPrice?: number | null;
  discount?: string | null;
  popular?: boolean;
  mostValue?: boolean;
  sortOrder?: number;
};

const currency = "INR" as const;

const formatPrice = (price: number) => `₹ ${price.toLocaleString("en-IN")}`;

/**
 * Default Buy Coins catalogue (aligned to product pricing).
 * Override at runtime with env `COIN_PACKAGES_JSON` (JSON array) on
 * payment-service and api-gateway — same value on both.
 */
const DEFAULT_COIN_PACKAGES: readonly CoinPackageInput[] = Object.freeze([
  {
    id: "coin_pack_100",
    coins: 100,
    price: 50,
    popular: false,
    mostValue: false,
    sortOrder: 1
  },
  {
    id: "coin_pack_220",
    coins: 220,
    price: 100,
    popular: false,
    mostValue: false,
    sortOrder: 2
  },
  {
    id: "coin_pack_1700",
    coins: 1700,
    price: 700,
    originalPrice: 800,
    discount: "10% off | Save ₹100",
    popular: true,
    mostValue: false,
    sortOrder: 3
  },
  {
    id: "coin_pack_1200",
    coins: 1200,
    price: 500,
    popular: false,
    mostValue: false,
    sortOrder: 4
  },
  {
    id: "coin_pack_2500",
    coins: 2500,
    price: 1000,
    popular: false,
    mostValue: false,
    sortOrder: 5
  },
  {
    id: "coin_pack_12600",
    coins: 12600,
    price: 5000,
    popular: false,
    mostValue: false,
    sortOrder: 6
  },
  {
    id: "coin_pack_25500",
    coins: 25500,
    price: 10000,
    popular: false,
    mostValue: false,
    sortOrder: 7
  },
  {
    id: "coin_pack_33000",
    coins: 33000,
    price: 12500,
    popular: false,
    mostValue: false,
    sortOrder: 8
  },
  {
    id: "coin_pack_53000",
    coins: 53000,
    price: 20000,
    popular: false,
    mostValue: true,
    sortOrder: 9
  }
]);

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && Math.floor(n) === n;
}

function isNonNegativeNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function normalizePackage(input: CoinPackageInput, index: number): CoinPackage | null {
  if (!input || typeof input.id !== "string" || !input.id.trim()) {
    return null;
  }
  if (!isPositiveInt(input.coins) || !isPositiveInt(input.price)) {
    return null;
  }

  const originalPrice =
    input.originalPrice == null || input.originalPrice === undefined
      ? undefined
      : isNonNegativeNumber(input.originalPrice)
        ? input.originalPrice
        : undefined;

  const discount =
    typeof input.discount === "string" && input.discount.trim()
      ? input.discount.trim()
      : undefined;

  const sortOrder = isPositiveInt(input.sortOrder) ? input.sortOrder : index + 1;

  return {
    id: input.id.trim(),
    coins: input.coins,
    price: input.price,
    currency,
    displayPrice:
      typeof input.displayPrice === "string" && input.displayPrice.trim()
        ? input.displayPrice.trim()
        : formatPrice(input.price),
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(discount ? { discount } : {}),
    popular: Boolean(input.popular),
    mostValue: Boolean(input.mostValue),
    sortOrder
  };
}

function parsePackagesFromEnv(): CoinPackageInput[] | null {
  const raw = process.env.COIN_PACKAGES_JSON;
  if (raw === undefined || raw.trim() === "") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn("[coin-packages] COIN_PACKAGES_JSON must be a non-empty JSON array; using defaults");
      return null;
    }
    return parsed as CoinPackageInput[];
  } catch (error) {
    console.warn(
      `[coin-packages] Failed to parse COIN_PACKAGES_JSON (${error instanceof Error ? error.message : error}); using defaults`
    );
    return null;
  }
}

function buildCatalogue(): CoinPackage[] {
  const fromEnv = parsePackagesFromEnv();
  const source = fromEnv ?? DEFAULT_COIN_PACKAGES;
  const normalized = source
    .map((pkg, index) => normalizePackage(pkg, index))
    .filter((pkg): pkg is CoinPackage => pkg !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (!normalized.length) {
    console.warn("[coin-packages] No valid packages after normalize; using defaults");
    return DEFAULT_COIN_PACKAGES.map((pkg, index) => normalizePackage(pkg, index)!).filter(Boolean);
  }

  const ids = new Set<string>();
  for (const pkg of normalized) {
    if (ids.has(pkg.id)) {
      console.warn(`[coin-packages] Duplicate package id "${pkg.id}"; using defaults`);
      return DEFAULT_COIN_PACKAGES.map((p, index) => normalizePackage(p, index)!).filter(Boolean);
    }
    ids.add(pkg.id);
  }

  return normalized;
}

/** Fresh catalogue each call so env changes apply after process restart (and tests can stub env). */
export function getCoinPackages(): CoinPackage[] {
  return buildCatalogue().map((pkg) => ({ ...pkg }));
}

export function getCoinPackage(packageId: string): CoinPackage | null {
  const pkg = buildCatalogue().find((coinPackage) => coinPackage.id === packageId);
  return pkg ? { ...pkg } : null;
}
