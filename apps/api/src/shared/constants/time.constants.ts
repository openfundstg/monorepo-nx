/**
 * The four durations everything here counts in.
 *
 * Written out once because they were written out four times: `MINUTE_MS` in two
 * fiat-deposit services, `MS_PER_MINUTE` in a sale service and `MS_PER_DAY` in
 * a retention sweep — the same arithmetic under three spellings, which is
 * exactly the kind of drift a shared constant exists to stop. Not because
 * anybody would get `60 * 1000` wrong, but because four names for one thing is
 * four places to look when reading a deadline.
 *
 * Deliberately not a date library. Everything in this codebase measures spans
 * in milliseconds against `Date.now()`, and these are the only spans it
 * measures.
 */
export const SECOND_MS = 1000

export const MINUTE_MS = 60 * SECOND_MS

export const HOUR_MS = 60 * MINUTE_MS

export const DAY_MS = 24 * HOUR_MS
