/**
 * Zoned-decimal codec parity cases — signed overpunch decoding + formatting.
 * Values computed by hand from the real VSAM data (no invented figures).
 */
import { describe, it, expect } from 'vitest';
import { decodeZoned, encodeZoned, formatMoney } from '../src/lib/zoned';

describe('zoned decimal — signed overpunch decoding', () => {
  it('account 1 ACCT-CURR-BAL `00000001940{` = 194.00 → 19400 cents', () => {
    expect(decodeZoned('00000001940{', 2)).toBe(19400);
  });
  it('account 1 ACCT-CREDIT-LIMIT `00000020200{` = 2020.00 → 202000 cents', () => {
    expect(decodeZoned('00000020200{', 2)).toBe(202000);
  });
  it('DALYTRAN `0000009190}` = -919.00 (overpunch `}` = 0,−) → -91900 cents', () => {
    expect(decodeZoned('0000009190}', 2)).toBe(-91900);
  });
  it('DALYTRAN `0000005047G` = 504.77 (overpunch `G` = 7,+) → 50477 cents', () => {
    expect(decodeZoned('0000005047G', 2)).toBe(50477);
  });

  it('encode/decode is an exact round trip (never floats)', () => {
    expect(encodeZoned(19400, 12, 2)).toBe('00000001940{');
    expect(encodeZoned(-91900, 11, 2)).toBe('0000009190}');
    expect(encodeZoned(50477, 11, 2)).toBe('0000005047G');
  });

  it('formatMoney: cents → signed 2-decimal display (INV-9)', () => {
    expect(formatMoney(19400)).toBe('194.00');
    expect(formatMoney(-57988)).toBe('-579.88');
    expect(formatMoney(90021)).toBe('900.21');
  });
});
