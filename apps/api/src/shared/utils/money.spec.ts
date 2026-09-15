/**
 * The whole-hryvnia money rules, which live in `@transacto/contracts` because
 * the Mini App and the backend must round identically — a disagreement between
 * them would block orders that were set up correctly.
 *
 * Exercised from here because the contracts package has no test target of its
 * own, and the backend is the side that enforces the rules: it snaps the stored
 * target and it runs the goal check.
 */
import { isWholeUah, roundToWholeUah } from '@transacto/contracts';

describe('roundToWholeUah', () => {
  /**
   * The case that prompted all of this: 200 USDT at ₴46.52 plus 2% came to
   * ₴9 490,08, and the create form told the user to set that as their jar's
   * goal. No bank has a kopecks field, so the goal check could never match and
   * every correctly set-up order would have been blocked.
   */
  it('turns the quote from the screenshot into a figure a bank accepts', () => {
    const equivalent = roundToWholeUah(200 * 4_652); // 9 304,00
    const target = roundToWholeUah(equivalent * 1.02); // was 9 490,08

    expect(target).toBe(949_000);
    expect(isWholeUah(target)).toBe(true);
  });

  it.each([
    [949_008, 949_000],
    [949_049, 949_000],
    // Half a hryvnia goes up, the way Math.round does.
    [949_050, 949_100],
    [949_099, 949_100],
    [100, 100],
    [0, 0],
  ])('rounds %p kopecks to %p', (input, expected) => {
    expect(roundToWholeUah(input)).toBe(expected);
  });

  it('leaves a figure that is already whole hryvnia alone', () => {
    expect(roundToWholeUah(949_000)).toBe(949_000);
  });
});

describe('isWholeUah', () => {
  it.each([949_000, 100, 0])('accepts %p', (value) => {
    expect(isWholeUah(value)).toBe(true);
  });

  it.each([949_008, 1, 99, 100.5])('rejects %p', (value) => {
    expect(isWholeUah(value)).toBe(false);
  });
});
