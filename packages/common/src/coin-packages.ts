export interface CoinPackage {
  id: string;
  coins: number;
  price: number;
  currency: "INR";
  displayPrice: string;
  originalPrice?: number;
  discount?: string;
  popular: boolean;
  sortOrder: number;
}

const currency = "INR" as const;
const formatPrice = (price: number) => `₹ ${price.toLocaleString("en-IN")}`;

const coinPackages: readonly CoinPackage[] = Object.freeze([
  {
    id: "coin_pack_100",
    coins: 100,
    price: 50,
    currency,
    displayPrice: formatPrice(50),
    popular: false,
    sortOrder: 1
  },
  {
    id: "coin_pack_200",
    coins: 200,
    price: 100,
    currency,
    displayPrice: formatPrice(100),
    popular: false,
    sortOrder: 2
  },
  {
    id: "coin_pack_700",
    coins: 700,
    price: 300,
    currency,
    displayPrice: formatPrice(300),
    originalPrice: 700,
    discount: "10% off | Save ₹ 100",
    popular: true,
    sortOrder: 3
  },
  {
    id: "coin_pack_450",
    coins: 450,
    price: 500,
    currency,
    displayPrice: formatPrice(500),
    popular: false,
    sortOrder: 4
  },
  {
    id: "coin_pack_2500",
    coins: 2500,
    price: 1000,
    currency,
    displayPrice: formatPrice(1000),
    popular: false,
    sortOrder: 5
  },
  {
    id: "coin_pack_12600",
    coins: 12600,
    price: 5000,
    currency,
    displayPrice: formatPrice(5000),
    popular: false,
    sortOrder: 6
  },
  {
    id: "coin_pack_25500",
    coins: 25500,
    price: 10000,
    currency,
    displayPrice: formatPrice(10000),
    popular: false,
    sortOrder: 7
  },
  {
    id: "coin_pack_33000",
    coins: 33000,
    price: 12500,
    currency,
    displayPrice: formatPrice(12500),
    popular: false,
    sortOrder: 8
  },
  {
    id: "coin_pack_53000",
    coins: 53000,
    price: 20000,
    currency,
    displayPrice: formatPrice(20000),
    popular: false,
    sortOrder: 9
  }
]);

export function getCoinPackages(): CoinPackage[] {
  return coinPackages.map((pkg) => ({ ...pkg }));
}

export function getCoinPackage(packageId: string): CoinPackage | null {
  const pkg = coinPackages.find((coinPackage) => coinPackage.id === packageId);
  return pkg ? { ...pkg } : null;
}
