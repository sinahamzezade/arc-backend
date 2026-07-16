import { directPairKey } from './chat.constants';

describe('chat.constants', () => {
  it('directPairKey is order-independent', () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    expect(directPairKey(a, b)).toBe(directPairKey(b, a));
    expect(directPairKey(a, b)).toBe(`${a}_${b}`);
  });
});
