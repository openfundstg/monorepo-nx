import { OrderStatus } from '@transacto/contracts';
import { historyMovement, processHistoryLog } from './history.utils';

const log = (over: Record<string, unknown> = {}) => ({
  delta: 0,
  balance: 0,
  orderEvents: [],
  ...over,
});

describe('processHistoryLog', () => {
  it('sums pending orders into expectedDelta when the balance has not moved', () => {
    const result = processHistoryLog(
      log({
        orderEvents: [
          { orderId: 1, amount: 1000, status: OrderStatus.PENDING },
          { orderId: 2, amount: 250, status: OrderStatus.PENDING },
        ],
      }),
    );

    expect(result.expectedDelta).toBe(1250);
  });

  it('ignores orders that are no longer pending', () => {
    const result = processHistoryLog(
      log({
        orderEvents: [
          { orderId: 1, amount: 1000, status: OrderStatus.PENDING },
          { orderId: 2, amount: 9999, status: OrderStatus.EXECUTED },
        ],
      }),
    );

    expect(result.expectedDelta).toBe(1000);
  });

  it('leaves expectedDelta unset once the balance has actually moved', () => {
    const result = processHistoryLog(
      log({ delta: 500, orderEvents: [{ orderId: 1, amount: 1000, status: OrderStatus.PENDING }] }),
    );

    expect(result.expectedDelta).toBeUndefined();
  });

  it('leaves expectedDelta unset when nothing is pending', () => {
    const result = processHistoryLog(
      log({ orderEvents: [{ orderId: 1, amount: 1000, status: OrderStatus.EXECUTED }] }),
    );

    expect(result.expectedDelta).toBeUndefined();
  });

  it('copies rather than mutating the row it was given', () => {
    const original = log({ orderEvents: [{ orderId: 1, amount: 10, status: OrderStatus.PENDING }] });
    processHistoryLog(original);

    expect('expectedDelta' in original).toBe(false);
  });
});

/**
 * The one rule all three money columns are measured by. They used to have three
 * separate implementations — and the actual-balance column had none at all, so
 * it was the only one that never showed an arrow.
 */
describe('historyMovement', () => {
  it('reports a rise', () => {
    expect(historyMovement(3_898_00, 3_294_00)).toBe(604_00);
  });

  it('reports a fall', () => {
    expect(historyMovement(3_294_00, 3_798_00)).toBe(-504_00);
  });

  /** No movement, no arrow. */
  it('is undefined when the figure did not move', () => {
    expect(historyMovement(3_294_00, 3_294_00)).toBeUndefined();
  });

  /** The oldest row has nothing below it to measure against. */
  it('is undefined without a previous row', () => {
    expect(historyMovement(3_294_00, undefined)).toBeUndefined();
  });

  it('is undefined when the figure itself is unknown', () => {
    expect(historyMovement(undefined, 3_294_00)).toBeUndefined();
  });

  /** Zero is a real figure, not a missing one. */
  it('reports movement away from zero', () => {
    expect(historyMovement(0, 500_00)).toBe(-500_00);
    expect(historyMovement(500_00, 0)).toBe(500_00);
  });
});
