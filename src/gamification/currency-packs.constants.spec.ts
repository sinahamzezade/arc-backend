import { CURRENCY_PACKS, findCurrencyPack } from './currency-packs.constants';

describe('CURRENCY_PACKS', () => {
  it('exposes xp payment on every pack and reserves iap product ids', () => {
    expect(CURRENCY_PACKS.length).toBeGreaterThanOrEqual(6);
    for (const pack of CURRENCY_PACKS) {
      expect(pack.paymentMethods).toContain('xp');
      expect(pack.xpPrice).toBeGreaterThan(0);
      expect(pack.amount).toBeGreaterThan(0);
      expect(pack.iapProductId).toMatch(/^arc\.(gems|coins)\.\d+$/);
    }
  });

  it('finds packs by sku', () => {
    expect(findCurrencyPack('gems-pack-10')?.amount).toBe(10);
    expect(findCurrencyPack('coins-pack-500')?.xpPrice).toBe(350);
    expect(findCurrencyPack('missing')).toBeUndefined();
  });
});
