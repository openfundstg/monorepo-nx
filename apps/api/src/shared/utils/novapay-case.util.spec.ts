import { BadRequestException } from '@nestjs/common'
import { ERROR } from '@transacto/contracts'
import { adaptNovaPayBalance, adaptNovaPayCard, parseNovaPayCase } from './novapay-case.util'
import type { NovaPayCaseData } from 'src/shared/interfaces'

/**
 * The captured case, trimmed to the fields these functions read.
 *
 * The full shape — every field the page carries — is declared on
 * {@link NovaPayCaseData}; repeating all of it in a fixture would mean two
 * statements of one contract.
 */
const caseData = (overrides: Partial<NovaPayCaseData> = {}): NovaPayCaseData =>
  ({
    public_id: 'Er6QMUgswz',
    amount: '2000.00',
    type: 'targeted',
    status: 'opened',
    name: 'На тест',
    balance: '0.00',
    owner: 'Петренко Іван',
    openGraphTags: {
      url: 'https://e-com.novapay.ua/case/Er6QMUgswz',
      title: 'На тест',
      description:
        'Петренко Іван збирає Кейс. Закидуй гроші за номером: 4000 7800 0000 3706. ' +
        'Закидуй гроші за посиланням https://e-com.novapay.ua/case/Er6QMUgswz',
      image: 'https://e-com.novapay.ua/public/assets/img/money-box.png',
      logo: 'https://e-com.novapay.ua/public/assets/img/logo-white.svg'
    },
    ...overrides
  }) as NovaPayCaseData

/** The page, as far as the parser is concerned: a marker and a literal. */
const page = (state: unknown, trailing = "window.__CSRF_TOKEN__ = 'x';") =>
  `<!DOCTYPE html><html><body><script>
     window.__NOVA_DATA__ = ${JSON.stringify(state)};
     ${trailing}
   </script></body></html>`

describe('parseNovaPayCase', () => {
  it('reads the state out of the page', () => {
    expect(parseNovaPayCase(page(caseData()))?.public_id).toBe('Er6QMUgswz')
  })

  /**
   * The reason this is brace-matched rather than regexed to the first `};`.
   * `deeplink` and `openGraphTags` are nested objects, and a case's own name is
   * free text somebody can put a brace in.
   */
  it('is not fooled by a brace inside the case’s own name', () => {
    const state = caseData({ name: 'Ремонт {кухні};', description: '}; drop' })

    expect(parseNovaPayCase(page(state))?.name).toBe('Ремонт {кухні};')
  })

  it('reads a state followed by nothing at all', () => {
    expect(parseNovaPayCase(page(caseData(), ''))?.balance).toBe('0.00')
  })

  /**
   * A maintenance page, a redirect to a login, or the day NovaPay renames the
   * variable. `null` is what the caller turns into a refusal — it must never
   * read as an empty case, which would look like a jar nobody has paid into.
   */
  it('answers null for a page carrying no state', () => {
    expect(parseNovaPayCase('<html><body>Сервіс тимчасово недоступний</body></html>')).toBeNull()
  })

  it('answers null for a state that is not valid JSON', () => {
    expect(
      parseNovaPayCase('<script>window.__NOVA_DATA__ = { balance: undefined };</script>')
    ).toBeNull()
  })

  it('answers null for a state that is never closed', () => {
    expect(parseNovaPayCase('<script>window.__NOVA_DATA__ = { "balance": "0.00"')).toBeNull()
  })

  /**
   * The first mention of the variable is not necessarily the assignment. A
   * guard like `window.__NOVA_DATA__ || {}` parses perfectly and carries
   * nothing — and an object with no `status` is a case that is not `opened`,
   * which is the verdict that retires the terminal, fails its orders and
   * releases the sale waiting on it.
   */
  it('skips an object that is not the state and keeps looking', () => {
    const html =
      `<script>const state = window.__NOVA_DATA__ || {};</script>` + page(caseData())

    expect(parseNovaPayCase(html)?.public_id).toBe('Er6QMUgswz')
  })

  it('answers null when the only object there is not a case', () => {
    expect(parseNovaPayCase('<script>window.__NOVA_DATA__ = { "hydrated": true };</script>')).toBeNull()
  })
})

describe('adaptNovaPayBalance', () => {
  it('scales the hryvnia strings to kopecks', () => {
    expect(adaptNovaPayBalance(caseData({ balance: '1706.50', amount: '2000.00' }))).toEqual({
      actualBalance: 170_650,
      goal: 200_000,
      status: 'ACTIVE'
    })
  })

  /** Everything downstream reads one word for "still taking money". */
  it('reports the status every other bank’s adapter reports', () => {
    expect(adaptNovaPayBalance(caseData()).status).toBe('ACTIVE')
  })

  /**
   * A case that is not open is finished, and that is a verdict rather than a
   * failure: the scrape loop retires the terminal on it.
   */
  it('refuses a case that is not open', () => {
    expect(() => adaptNovaPayBalance(caseData({ status: 'closed' }))).toThrow(BadRequestException)
    try {
      adaptNovaPayBalance(caseData({ status: 'closed' }))
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual(ERROR.TERMINAL.INACTIVE)
    }
  })

  it('refuses a balance that is not a number', () => {
    expect(() => adaptNovaPayBalance(caseData({ balance: '—' }))).toThrow(BadRequestException)
  })

  /**
   * The exact page that cost a terminal, captured live from case `3g0nPEoQJ9`
   * on 2026-09-05: a balance of `"1 526.00"` beside a target of `"6642.00"`.
   *
   * NovaPay groups the raw balance past a thousand and does not group the raw
   * target, so there was no rule to infer from one to the other — and the first
   * capture was taken at a zero balance, where the two forms are the same three
   * characters. `parseFloat('1 526.00')` is `1`, so the jar reported ₴1. That is
   * not an error downstream: it is a balance below the baseline, which is how
   * the scraper recognises a withdrawal. `Balance dropped from 91800 to 100` —
   * FRAUD alert, credential disabled on Transacto, pending orders failed, a live
   * sale stopped.
   */
  it('reads the live page that reported ₴1 526 as ₴1', () => {
    expect(adaptNovaPayBalance(caseData({ balance: '1 526.00', amount: '6642.00' }))).toEqual({
      actualBalance: 152_600,
      goal: 664_200,
      status: 'ACTIVE'
    })
  })

  it('reads a four-figure balance however NovaPay groups it', () => {
    const grouped = [
      '1917.00',
      '1 917.00',
      '1\u00A0917.00',
      '1\u202F917.00',
      '1,917.00',
      '1917,00'
    ]

    for (const balance of grouped) {
      expect(adaptNovaPayBalance(caseData({ balance })).actualBalance).toBe(191_700)
    }
  })

  it('reads a grouped target the same way', () => {
    expect(adaptNovaPayBalance(caseData({ amount: '6 642.00' })).goal).toBe(664_200)
  })

  /**
   * A figure that is only *partly* a number is refused, never truncated. The
   * scrape loop retries a refusal and logs it; there is no recovering from a
   * plausible wrong number, because nothing downstream can tell it apart from a
   * real one.
   */
  it('refuses a figure it can only read part of', () => {
    const unreadable = ['1 917.00 грн', '₴1 917.00', '1.917.00', '', 'NaN', '1e3', '-5.00']

    for (const balance of unreadable) {
      expect(() => adaptNovaPayBalance(caseData({ balance }))).toThrow(BadRequestException)
    }
  })

  /** A provider swapping a decimal string for a number is readable, not a change of meaning. */
  it('reads a balance that arrives as a number', () => {
    expect(
      adaptNovaPayBalance(caseData({ balance: 1917.5 as unknown as string })).actualBalance
    ).toBe(191_750)
  })

  /**
   * `goal` is compared against the order's own total, so a zero would read as a
   * target nothing can ever match rather than as "no target".
   */
  it('reports no goal rather than a zero one', () => {
    expect(adaptNovaPayBalance(caseData({ amount: '0.00' })).goal).toBeUndefined()
    expect(adaptNovaPayBalance(caseData({ amount: 'нема' })).goal).toBeUndefined()
  })
})

describe('adaptNovaPayCard', () => {
  it('reads the card out of the sharing sentence', () => {
    expect(adaptNovaPayCard(caseData())).toBe('4000780000003706')
  })

  /** The digits are grouped however NovaPay feels like grouping them. */
  it('takes the digits however they are spaced', () => {
    const state = caseData({
      openGraphTags: {
        ...caseData().openGraphTags,
        description: 'Закидуй гроші за номером: 4000780000003706. Далі текст'
      }
    })

    expect(adaptNovaPayCard(state)).toBe('4000780000003706')
  })

  /**
   * Anchored on the label, because the same sentence carries a link whose id
   * has digits in it and a title the owner chose.
   */
  it('is not distracted by other numbers in the sentence', () => {
    const state = caseData({
      openGraphTags: {
        ...caseData().openGraphTags,
        description:
          'Кейс 2024 на 5000 грн. Закидуй гроші за номером: 4000 7800 0000 3706. ' +
          'Посилання https://e-com.novapay.ua/case/1234567890'
      }
    })

    expect(adaptNovaPayCard(state)).toBe('4000780000003706')
  })

  /**
   * The only thing worse than no card here is a plausible wrong one: the form
   * fills this field in and the user never checks it.
   */
  it('answers null for anything that is not sixteen digits', () => {
    const withNumber = (text: string) =>
      caseData({ openGraphTags: { ...caseData().openGraphTags, description: text } })

    expect(adaptNovaPayCard(withNumber('за номером: 4000 7800 0103'))).toBeNull()
    expect(adaptNovaPayCard(withNumber('за номером: 4000 7800 0000 3706 9999'))).toBeNull()
  })

  /** The day they reword it, or a case shared without a card at all. */
  it('answers null when the sentence is not there', () => {
    const state = caseData({
      openGraphTags: { ...caseData().openGraphTags, description: 'Петренко Іван збирає Кейс.' }
    })

    expect(adaptNovaPayCard(state)).toBeNull()
  })
})
