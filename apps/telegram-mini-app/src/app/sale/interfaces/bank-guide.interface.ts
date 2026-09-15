/** One numbered step of a bank's setup guide. */
export interface BankGuideStep {
  /**
   * The full translation key, written out rather than assembled at runtime.
   *
   * Concatenated keys are the thing `i18n.spec.ts` warns about: a grep for
   * `sale.guide.MONO.step_1` has to find the place that renders it, or the key
   * looks unused and gets deleted.
   */
  readonly textKey: string;
  /**
   * Screenshot path under `public/`, or `null` for a step that needs no
   * picture. A file that is not there yet renders as a labelled placeholder —
   * see `BankInstructionsComponent`.
   */
  readonly image: string | null;
}

/** Everything the instructions block renders for one bank. */
export interface BankGuide {
  readonly steps: readonly BankGuideStep[];
  /**
   * A correct link, shown verbatim.
   *
   * Not a translation key on purpose: a URL reads the same in every language,
   * and putting it in the dictionaries would mean three chances to typo the one
   * string the user is meant to pattern-match against.
   */
  readonly linkExample: string;
  /** Translation key of the caveat that costs users the most orders. */
  readonly warningKey: string;
  /**
   * What to do when the automatic resolution does not work, for banks that
   * depend on it.
   *
   * Only PUMB has one: its link is resolved server-side by following a
   * redirect, and if the bank refuses that request the user still needs a way
   * through. Absent for banks whose share link is already usable, since there
   * is nothing to fall back from.
   */
  readonly fallbackKey?: string;
}
