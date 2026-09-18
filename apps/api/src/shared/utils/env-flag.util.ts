/**
 * Whether an environment variable says yes.
 *
 * Three spellings of this existed — `env === 'true'` twice and a trimmed,
 * lower-cased comparison once — and only the third survived a value with a
 * trailing space, which is what a `.env` file produces every time somebody
 * lines the values up. The strictest reading was the one that was right, so it
 * became the only one.
 *
 * **Anything that is not `true` is false**, including `1` and `yes`. A flag
 * that guesses is a flag whose meaning depends on who wrote the file, and every
 * one of these guards something worth being unambiguous about — a kill switch,
 * a fail-closed verification, a matcher that spends money.
 */
export const isEnabledFlag = (value: string | undefined): boolean =>
  (value ?? '').trim().toLowerCase() === 'true'
