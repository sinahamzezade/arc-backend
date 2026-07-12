/**
 * Soft-currency packs.
 * Today: buy with lifetime XP.
 * Later: same SKUs can accept IAP via `iapProductId` + paymentMethod=iap.
 */
export type CurrencyPackTarget = 'gems' | 'coins';

export type CurrencyPackPaymentMethod = 'xp' | 'iap';

export type CurrencyPackDef = {
  sku: string;
  title: string;
  description: string;
  target: CurrencyPackTarget;
  amount: number;
  /** Lifetime XP cost when paying with XP. */
  xpPrice: number;
  /** App Store / Play product id — wired when IAP lands. */
  iapProductId: string | null;
  /** Methods currently enabled for this pack. */
  paymentMethods: CurrencyPackPaymentMethod[];
};

export const CURRENCY_PACKS: readonly CurrencyPackDef[] = [
  {
    sku: 'gems-pack-10',
    title: 'Spark Pack',
    description: '10 gems for streak tools and hints',
    target: 'gems',
    amount: 10,
    xpPrice: 100,
    iapProductId: 'arc.gems.10',
    paymentMethods: ['xp'],
  },
  {
    sku: 'gems-pack-50',
    title: 'Shield Pack',
    description: '50 gems — better XP rate',
    target: 'gems',
    amount: 50,
    xpPrice: 450,
    iapProductId: 'arc.gems.50',
    paymentMethods: ['xp'],
  },
  {
    sku: 'gems-pack-120',
    title: 'Vault Pack',
    description: '120 gems for serious recovery',
    target: 'gems',
    amount: 120,
    xpPrice: 1000,
    iapProductId: 'arc.gems.120',
    paymentMethods: ['xp'],
  },
  {
    sku: 'coins-pack-100',
    title: 'Pocket Coins',
    description: '100 coins for light cosmetics',
    target: 'coins',
    amount: 100,
    xpPrice: 80,
    iapProductId: 'arc.coins.100',
    paymentMethods: ['xp'],
  },
  {
    sku: 'coins-pack-500',
    title: 'Style Bundle',
    description: '500 coins — better XP rate',
    target: 'coins',
    amount: 500,
    xpPrice: 350,
    iapProductId: 'arc.coins.500',
    paymentMethods: ['xp'],
  },
  {
    sku: 'coins-pack-1500',
    title: 'Arena Chest',
    description: '1,500 coins for cosmetics + stakes',
    target: 'coins',
    amount: 1500,
    xpPrice: 900,
    iapProductId: 'arc.coins.1500',
    paymentMethods: ['xp'],
  },
] as const;

export function findCurrencyPack(sku: string): CurrencyPackDef | undefined {
  return CURRENCY_PACKS.find((p) => p.sku === sku);
}
