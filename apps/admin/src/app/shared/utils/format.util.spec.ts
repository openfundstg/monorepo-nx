import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatNumber,
  formatUah,
  formatUsdt,
  formatUsdtWhole,
} from './format.util';

/**
 * The three money units are not interchangeable, and these tests exist to say
 * so out loud: fiat is UAH kopecks, balances are USDT cents, and a deposit's
 * own figure is whole USDT. Passing one to another's formatter is a
 * hundredfold error that no type catches, since all three are `number`.
 */
describe('money formatting', () => {
  it('renders kopecks as hryvnia', () => {
    expect(formatUah(123456)).toContain('1');
    expect(formatUah(123456)).toMatch(/234,56/);
    expect(formatUah(0)).toMatch(/0,00/);
  });

  it('renders cents as USDT', () => {
    expect(formatUsdt(1050)).toMatch(/10,50 USDT/);
  });

  it('renders whole USDT unscaled — the figure a user typed on the deposit form', () => {
    expect(formatUsdtWhole(10.5)).toMatch(/10,50 USDT/);
    // The distinction that matters: 1050 cents and 1050 whole USDT are a
    // hundredfold apart, and only the caller knows which it holds.
    expect(formatUsdtWhole(1050)).not.toEqual(formatUsdt(1050));
  });

  it('renders an absent figure as an em dash rather than zero', () => {
    // Zero and "not known" are different facts. A jar that has never been
    // scraped has no balance; showing it as ₴0,00 says it is empty.
    expect(formatUah(null)).toBe('—');
    expect(formatUsdt(undefined)).toBe('—');
    expect(formatNumber(null)).toBe('—');
    expect(formatDateTime(null)).toBe('—');
  });

  it('formats an ISO timestamp', () => {
    expect(formatDateTime('2026-09-02T11:30:00.000Z')).toMatch(/\d{2}\.\d{2}\.\d{2}/);
  });
});
