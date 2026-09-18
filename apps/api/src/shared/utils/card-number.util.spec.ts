import { CARD_NUMBER_LENGTH, cardDigits, formatCardNumber, isLuhnValid } from '@transacto/contracts'
import { isSameCardNumber } from 'src/shared/utils/card-number.util'
import { matchesMaskedCard } from '@transacto/contracts'

/** The envelope from the live check, as PrivatBank reports it. */
const BANK = '5168750000003407'

describe('isSameCardNumber', () => {
  it('matches the same digits', () => {
    expect(isSameCardNumber(BANK, BANK)).toBe(true)
  })

  /**
   * The user types a grouped number off their phone while the bank reports a
   * bare one. A string comparison would call two spellings of one card a
   * mismatch — and this check refuses an order, so that is the expensive
   * direction to be wrong in.
   */
  it.each([
    '5168 7500 0000 3407',
    '5168-7500-0000-3407',
    '  5168750000003407  ',
    '5168 7500-0000 3407',
  ])('matches %p, however it was typed', (typed) => {
    expect(isSameCardNumber(BANK, typed)).toBe(true)
  })

  it('rejects a different card', () => {
    expect(isSameCardNumber(BANK, '5168750000001914')).toBe(false)
  })

  it('rejects a prefix of the right card', () => {
    expect(isSameCardNumber(BANK, '51687521')).toBe(false)
  })

  /**
   * An unknown card must never satisfy a check whose whole purpose is to prove
   * the card is known.
   */
  it.each([
    ['', ''],
    ['', BANK],
    [BANK, ''],
    ['   ', BANK],
    [BANK, 'not a card'],
  ])('refuses to match %p against %p', (left, right) => {
    expect(isSameCardNumber(left, right)).toBe(false)
  })
})

/**
 * The rule lives in `@transacto/contracts` so the create form and the server
 * cannot disagree. A client that accepted a pair the server refuses lets a user
 * submit an order rejected the instant it arrives; one that refused a pair the
 * server accepts blocks an order that was set up correctly.
 */
describe('cardDigits', () => {
  it('strips the spacing a human types', () => {
    expect(cardDigits('5168 7500 0000 3407')).toBe('5168750000003407')
  })

  it('strips dashes and stray whitespace too', () => {
    expect(cardDigits(' 5168-7500-0000-3407 ')).toBe('5168750000003407')
  })

  /** What the form counts to decide the card is whole enough to check. */
  it('leaves a whole card at the declared length', () => {
    expect(cardDigits('5168 7500 0000 3407')).toHaveLength(CARD_NUMBER_LENGTH)
  })
})

/**
 * PUMB publishes twelve of sixteen digits on a moneybox. Enough to refuse a
 * card that cannot be the right one; never enough to call one right.
 */
describe('matchesMaskedCard', () => {
  const MASK = '53552800****0000'
  const CARD = '5355280012340000'

  it('accepts a card that fits the visible digits', () => {
    expect(matchesMaskedCard(CARD, MASK)).toBe(true)
  })

  it('accepts it however the user spaced it', () => {
    expect(matchesMaskedCard('5355 2800 1234 0000', MASK)).toBe(true)
  })

  it.each([
    ['a different bank prefix', '4149280012340000'],
    ['different last four', '5355280012340001'],
    ['one digit short', '535528001234000']
  ])('refuses %s', (_case, typed) => {
    expect(matchesMaskedCard(typed, MASK)).toBe(false)
  })

  /**
   * The masked positions are the only ones free. A card matching everywhere
   * except a revealed digit is a different card, not a near miss.
   */
  it('refuses a card that differs only inside the visible half', () => {
    expect(matchesMaskedCard('5355280112340000', MASK)).toBe(false)
  })

  /**
   * How much a bank reveals is theirs to change, so the shape is read off the
   * mask rather than assumed to be eight-and-four.
   */
  it('follows whatever shape the bank sends', () => {
    expect(matchesMaskedCard(CARD, '5355********0000')).toBe(true)
    expect(matchesMaskedCard(CARD, '535528001234000*')).toBe(true)
  })

  /** An unknown mask must never satisfy a check whose purpose is proof. */
  it.each([['empty', ''], ['not a mask at all', 'no idea']])(
    'refuses %s as a mask',
    (_case, mask) => {
      expect(matchesMaskedCard(CARD, mask)).toBe(false)
    }
  )
})


describe('formatCardNumber', () => {
  it('groups sixteen digits the way a card prints them', () => {
    expect(formatCardNumber('4444333322221111')).toBe('4444 3333 2222 1111')
  })

  it('groups a partial number without trailing space', () => {
    expect(formatCardNumber('44443333')).toBe('4444 3333')
  })

  /** The commonest way this field is filled is a paste out of a banking app. */
  it.each([
    ['already spaced', '4444 3333 2222 1111'],
    ['dashed', '4444-3333-2222-1111'],
    ['run together with stray whitespace', '  4444333322221111 ']
  ])('normalises a number pasted %s', (_case, pasted) => {
    expect(formatCardNumber(pasted)).toBe('4444 3333 2222 1111')
  })

  /** Nothing past sixteen digits, however much is typed or pasted. */
  it('never grows past one card', () => {
    expect(formatCardNumber('4444333322221111999')).toBe('4444 3333 2222 1111')
  })
})

describe('isLuhnValid', () => {
  it('accepts a number whose check digit agrees', () => {
    expect(isLuhnValid('4444333322221111')).toBe(true)
  })

  it('accepts it spaced exactly as the field shows it', () => {
    expect(isLuhnValid('4444 3333 2222 1111')).toBe(true)
  })

  /**
   * The two mistakes Luhn exists to catch, and the ones this field actually
   * suffers: a single wrong digit and a transposed pair.
   */
  it.each([
    ['one wrong digit', '4444333322221112'],
    ['a transposed pair', '4444333322212111']
  ])('refuses %s', (_case, typo) => {
    expect(isLuhnValid(typo)).toBe(false)
  })

  /**
   * Length is part of the verdict. A checksum that happens to pass on fifteen
   * digits is an unfinished card, not another scheme — this field is for
   * Ukrainian cards and those are sixteen.
   */
  it.each([['fifteen', '444433332222111'], ['seventeen', '44443333222211110'], ['empty', '']])(
    'refuses %s digits whatever the sum does',
    (_case, value) => {
      expect(isLuhnValid(value)).toBe(false)
    }
  )
})
