import { formatAlertMetadata } from './alert.utils';
import type { AlertData } from '../../terminal/interfaces/terminal.interface';

const alert = (over: Partial<AlertData> = {}): AlertData => ({
  id: 'a1',
  type: 'UNRECOGNIZED_DEPOSIT',
  isRead: false,
  timestamp: new Date(0),
  ...over,
});

describe('formatAlertMetadata', () => {
  it('renders kopeck amounts as decimal strings', () => {
    const [formatted] = formatAlertMetadata([alert({ amount: 123_456 })]);
    // 123456 kopecks = 1234.56 UAH; uk-UA groups with a non-breaking space
    expect(String(formatted.amount).replace(/\s/g, ' ')).toBe('1 234,56');
  });

  it('formats every top-level money field', () => {
    const [formatted] = formatAlertMetadata([alert({ amount: 100, left: 200, goal: 300 })]);
    expect([formatted.amount, formatted.left, formatted.goal]).toEqual(['1,00', '2,00', '3,00']);
  });

  it('formats the amounts nested in metadata', () => {
    const [formatted] = formatAlertMetadata([
      alert({ metadata: { previousBalance: 5000, currentBalance: 100, unrelated: 'kept' } }),
    ]);

    expect(formatted.metadata).toEqual({
      previousBalance: '50,00',
      currentBalance: '1,00',
      unrelated: 'kept',
    });
  });

  it('leaves the original alert untouched', () => {
    // The component relies on this: the store still holds numbers it can post back
    const original = alert({ amount: 123_456, metadata: { amount: 500 } });
    formatAlertMetadata([original]);

    expect(original.amount).toBe(123_456);
    expect(original.metadata).toEqual({ amount: 500 });
  });

  it('keeps the fields the template reads as real properties', () => {
    const [formatted] = formatAlertMetadata([alert({ isRead: true, terminalId: 7 })]);
    expect([formatted.id, formatted.type, formatted.isRead, formatted.terminalId]).toEqual([
      'a1',
      'UNRECOGNIZED_DEPOSIT',
      true,
      7,
    ]);
  });

  it('skips a zero amount rather than printing 0,00', () => {
    const [formatted] = formatAlertMetadata([alert({ amount: 0 })]);
    expect(formatted.amount).toBe(0);
  });

  it('leaves counts alone — only money is scaled', () => {
    // combinationsCount is a count, not kopecks. Scaling it would render
    // "Found 0,03 combinations".
    const [formatted] = formatAlertMetadata([
      alert({ type: 'AMBIGUOUS_DEPOSIT', metadata: { amount: 5000, combinationsCount: 3 } }),
    ]);

    expect(formatted.metadata).toEqual({ amount: '50,00', combinationsCount: 3 });
  });

  it('scales totalDelta, which is money', () => {
    const [formatted] = formatAlertMetadata([alert({ metadata: { totalDelta: 12_345 } })]);
    expect(formatted.metadata).toEqual({ totalDelta: '123,45' });
  });
});
