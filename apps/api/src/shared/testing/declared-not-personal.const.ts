/** One value that looks like a personal identifier, and the reason it is not one. */
export interface DeclaredValue {
  readonly value: string
  readonly why: string
}

const declare = (why: string, ...values: readonly string[]): readonly DeclaredValue[] =>
  values.map((value) => ({ value, why }))

/**
 * Every value in this repository that a scanner reads as a personal identifier,
 * each with the reason it may stay.
 *
 * **Adding an entry here is a claim, and that is the whole point of the file.**
 * `no-real-data.spec.ts` fails on any card number, masked card, IBAN or tax id
 * it finds in the source that is not listed below, so a value cannot arrive by
 * being pasted — somebody has to come here and write down why it is safe.
 *
 * The rule it enforces is in the root `CLAUDE.md` under *Real data never lives
 * in the repository*, and the rule alone was not enough: it was written, it was
 * read, and three real values were committed anyway — a tax number, a person's
 * name and a masked card. Removing them took a history rewrite and a
 * force-push, which is the cost this list exists to never pay again.
 *
 * **What belongs here is the invented and the misread, never the real.** If the
 * honest sentence for a value is "it is real but it is only a test account",
 * the value does not belong in the repository at all. Names are not listed
 * because they cannot be told apart mechanically — they are CHECK 8 of the
 * strict reviewer instead.
 */
export const DECLARED_NOT_PERSONAL: readonly DeclaredValue[] = [
  ...declare(
    'A card the scheme publishes for testing, or one invented for a fixture. ' +
      'Recognisable by construction: repeated digits, zero padding, or a BIN ' +
      'kept because BIN logic needs it with an invented body.',
    '0000000000000000',
    '4000780000003706',
    '4111111111111111',
    '4149280012340000',
    '4400000000005551',
    '4441110000005500',
    '4441110000006102',
    '4441111122223333',
    '4441118888888671',
    '4444333322212111',
    '4444333322221',
    '444433332222111',
    '4444333322221111',
    '44443333222211110',
    '4444333322221111999',
    '4444333322221112',
    '4874100000003007',
    '4874100000003205',
    '5168750000001914',
    '5168750000003407',
    '5168750000007416',
    '535528001234000',
    '5355280012340000',
    '5355280012340001',
    '5355280112340000',
    '5375414122223333'
  ),
  ...declare(
    'A masked card, invented. The banks disclose these partially and the ' +
      'shapes differ between them, so the fixtures keep the shape and not the ' +
      'digits — a masked PAN is a payment credential exactly as a whole one is.',
    '440000******5551',
    '4441********8671',
    '4441**8671',
    '444111******8671',
    '444111******9718',
    '512345******9999',
    '516875******7416',
    '5355********0000',
    '53552800****0000',
    '5375 **** **** 4321',
    '537541******4321'
  ),
  ...declare(
    'An IBAN invented for a fixture: the country code and the length are real ' +
      'so the format checks are honest, and everything after is zeros.',
    'UA000000000000000000000000000',
    'UA080000000000000000000000003',
    'UA350000000000000000000000002',
    'UA510000000000000000000000005',
    'UA620000000000000000000000001',
    'UA780000000000000000000000004'
  ),
  ...declare(
    'Not a card at all, and only reads as one because it is a long run of ' +
      'digits. Each is what its own file says it is.',
    // The exchange rate a broken migration wrote onto every sale — 1.0143…e97.
    '0143093894706378',
    // Telegram's own identifiers: a group id, and two emoji ids in the support bot.
    '1002345678901',
    '5237690000009300968',
    '5417910000005203993',
    // The Meta Pixel id, which is an advertising account and not a person.
    '952959427063504',
    // PUMB encodes a balance as an offset from a large negative constant.
    '99999999996400',
    '99999999999900',
    '00000000000000'
  ),
  ...declare(
    'Ten zeros: a placeholder that happens to satisfy the tax-number checksum, ' +
      'which is what makes it readable as one. Nobody has this number.',
    '0000000000'
  )
]

/** The values alone, for the scanner to compare against. */
export const DECLARED_VALUES: ReadonlySet<string> = new Set(
  DECLARED_NOT_PERSONAL.map((declared) => declared.value)
)
