/**
 * Position in the three-step tracker on the status page.
 *
 * `Failed` deliberately sits below `Created` so a single `step() >= N` test in
 * the template dims every step at once when the order dies.
 */
export const SaleStep = {
  Failed: 0,
  Created: 1,
  TerminalReady: 2,
  Completed: 3,
} as const;

export type SaleStep = (typeof SaleStep)[keyof typeof SaleStep];
