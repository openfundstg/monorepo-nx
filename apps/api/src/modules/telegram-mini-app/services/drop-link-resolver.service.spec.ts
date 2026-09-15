import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { BankProvider } from '@transacto/contracts'
import { ScraperWorkerMethod, type ScraperWorkerResult } from 'src/shared/interfaces'
import type { ScraperWorkerService } from 'src/shared/scraper-worker'
import { DropLinkResolverService } from './drop-link-resolver.service'
import type { BankScraperApiService } from 'src/modules/bank-scraper'

let bankScraperApi: {
  fetchPrivatEnvelope: jest.Mock
  fetchMonoJar: jest.Mock
  fetchPumbBox: jest.Mock
  fetchNovaPayCase: jest.Mock
}

// The worker relays two kinds of call: a GET for a redirect hop and the mono
// POST handshake. They are split so each test drives its own kind, exactly as
// the axios get/post mocks did before this went through the worker.
const workerGet = jest.fn<Promise<ScraperWorkerResult>, [Record<string, unknown>]>()
const workerPost = jest.fn<Promise<ScraperWorkerResult>, [Record<string, unknown>]>()

const workerResult = (over: Partial<ScraperWorkerResult>): ScraperWorkerResult => ({
  upstreamStatus: 200,
  body: Buffer.from(''),
  ...over
})

/** A 3xx hop, as the worker returns it: the target's status and its `Location`. */
const redirectTo = (location: string): ScraperWorkerResult => workerResult({ upstreamStatus: 302, location })

/** A terminal response — no `Location`, so the chain ends here. */
const noRedirect: ScraperWorkerResult = workerResult({ upstreamStatus: 200 })

/** A mono handshake body, wrapped as the worker returns bytes. */
const monoResult = (data: Record<string, unknown>): ScraperWorkerResult =>
  workerResult({ body: Buffer.from(JSON.stringify(data)) })

const SHORT_LINK = 'https://mobile-app.pumb.ua/1MMsg'
const BOX_LINK =
  'https://frames.payhub.com.ua/moneybox?box_id=7df8cc1b-4b6d-440e-8e65-c0bee6a18821'

/** A live PUMB moneybox record, trimmed to what the resolver reads. */
const moneybox = (overrides: Record<string, unknown> = {}) => ({
  box_id: '344213ac-1384-4e7f-a9e2-cd38ed48a753',
  owner_name: 'Іван П.',
  status: 'ACTIVE',
  total_amount: 0,
  amount: 80_000,
  card_to_hash: '53552800****0000',
  iban: 'UA350000000000000000000000002',
  ...overrides
})

describe('DropLinkResolverService', () => {
  let service: DropLinkResolverService

  beforeEach(() => {
    workerGet.mockReset()
    workerPost.mockReset()
    const worker = {
      request: jest.fn((req: Record<string, unknown>) =>
        req.method === ScraperWorkerMethod.POST ? workerPost(req) : workerGet(req)
      )
    }
    bankScraperApi = {
      fetchPumbBox: jest.fn().mockResolvedValue(moneybox()),
      fetchPrivatEnvelope: jest.fn(),
      // Unreachable by default, so every existing Monobank case still measures
      // the handshake alone — the jar record is a second, optional call.
      fetchMonoJar: jest.fn().mockRejectedValue(new Error('not stubbed')),
      fetchNovaPayCase: jest.fn().mockRejectedValue(new Error('not stubbed')),
    }
    service = new DropLinkResolverService(
      bankScraperApi as unknown as BankScraperApiService,
      worker as unknown as ScraperWorkerService
    )
  })

  /**
   * PrivatBank's envelope record is public to anyone holding the share link,
   * and it names the card the drop pays into, the target it is set to, and a
   * masked owner. Reading it at resolve time is what lets a wrong card be
   * refused before a stake is frozen.
   */
  describe('PrivatBank envelopes', () => {
    const LINK = 'https://next.privat24.ua/send/4prnv'

    const envelope = (over: Record<string, unknown> = {}) => ({
      data: {
        availableBalance: '800.00',
        goalAmount: '1000.00',
        card: '5168750000003407',
        ownerName: 'Петренко І.',
        active: true,
        ...over
      }
    })

    it('reports the card, the goal and the owner', async () => {
      bankScraperApi.fetchPrivatEnvelope.mockResolvedValue(envelope())

      const result = await service.resolve(BankProvider.PRIVAT, LINK)

      expect(result).toEqual({
        link: LINK,
        resolved: false,
        // Kopecks on the wire; PrivatBank reports hryvnia as a decimal string.
        goal: 100_000,
        cardNumber: '5168750000003407',
        // PrivatBank names the whole card, so there is no mask to fall back on.
        cardNumberMask: null,
        ownerName: 'Петренко І.'
      })
    })

    it('asks for the envelope behind the link’s own hash', async () => {
      bankScraperApi.fetchPrivatEnvelope.mockResolvedValue(envelope())

      await service.resolve(BankProvider.PRIVAT, LINK)

      expect(bankScraperApi.fetchPrivatEnvelope).toHaveBeenCalledWith('4prnv')
    })

    /** It can never receive the money, so this one is a verdict, not a hiccup. */
    it('refuses a closed envelope', async () => {
      bankScraperApi.fetchPrivatEnvelope.mockResolvedValue(envelope({ active: false }))

      await expect(service.resolve(BankProvider.PRIVAT, LINK)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    /**
     * The card and the goal are conveniences. A PrivatBank outage must not stop
     * someone creating an order — it only costs them the pre-checks.
     */
    it('still resolves the link when PrivatBank cannot be read', async () => {
      bankScraperApi.fetchPrivatEnvelope.mockRejectedValue(new Error('502'))

      const result = await service.resolve(BankProvider.PRIVAT, LINK)

      expect(result).toEqual({
        link: LINK,
        resolved: false,
        goal: null,
        cardNumber: null,
        cardNumberMask: null,
        ownerName: null
      })
    })

    it('reports a goal-less envelope as unknown rather than zero', async () => {
      bankScraperApi.fetchPrivatEnvelope.mockResolvedValue(envelope({ goalAmount: undefined }))

      const result = await service.resolve(BankProvider.PRIVAT, LINK)

      expect(result.goal).toBeNull()
    })
  })

  /**
   * The record is the whole reason PUMB can be created on again: it names the
   * owner, the target, and twelve of the card's sixteen digits.
   */
  /**
   * A NovaPay case is the one drop that names its card in full *and* needs no
   * resolving to be scrapeable: the page the user pastes is the page the
   * scraper reads. What the call buys is the card, the owner and the target.
   */
  describe('NovaPay cases', () => {
    const LINK = 'https://e-com.novapay.ua/case/Er6QMUgswz'

    const kase = (over: Record<string, unknown> = {}) => ({
      public_id: 'Er6QMUgswz',
      amount: '2000.00',
      status: 'opened',
      balance: '0.00',
      owner: 'Петренко Іван',
      openGraphTags: {
        description:
          'Петренко Іван збирає Кейс. Закидуй гроші за номером: 4000 7800 0000 3706. ' +
          'Закидуй гроші за посиланням https://e-com.novapay.ua/case/Er6QMUgswz'
      },
      ...over
    })

    it('reports the card, the goal and the owner', async () => {
      bankScraperApi.fetchNovaPayCase.mockResolvedValue(kase())

      const result = await service.resolve(BankProvider.NOVAPAY, LINK)

      expect(result).toEqual({
        // The link the user pasted is already the one to submit.
        link: LINK,
        resolved: false,
        // Kopecks on the wire; NovaPay reports hryvnia as a decimal string.
        goal: 200_000,
        // Read out of the sharing sentence — the JSON carries only an IBAN.
        cardNumber: '4000780000003706',
        cardNumberMask: null,
        // Unmasked, unlike every other bank: a case publishes its owner in full.
        ownerName: 'Петренко Іван'
      })
    })

    it('asks for the case named in the link', async () => {
      bankScraperApi.fetchNovaPayCase.mockResolvedValue(kase())

      await service.resolve(BankProvider.NOVAPAY, LINK)

      expect(bankScraperApi.fetchNovaPayCase).toHaveBeenCalledWith('Er6QMUgswz')
    })

    /** It can never receive the money, so this is a verdict, not a hiccup. */
    it('refuses a case that is not open', async () => {
      bankScraperApi.fetchNovaPayCase.mockResolvedValue(kase({ status: 'closed' }))

      await expect(service.resolve(BankProvider.NOVAPAY, LINK)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    /**
     * The form fills the card field from this and does not let the user edit
     * it, so there is nothing to fall back to: an order created without a card
     * is an order nobody can pay.
     */
    it('refuses a case whose sentence states no card', async () => {
      bankScraperApi.fetchNovaPayCase.mockResolvedValue(
        kase({ openGraphTags: { description: 'Петренко Іван збирає Кейс.' } })
      )

      await expect(service.resolve(BankProvider.NOVAPAY, LINK)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    /** A bank that cannot be reached is not a verdict about the case. */
    it('answers with nothing known when NovaPay cannot be reached', async () => {
      bankScraperApi.fetchNovaPayCase.mockRejectedValue(new Error('ECONNRESET'))

      await expect(service.resolve(BankProvider.NOVAPAY, LINK)).resolves.toEqual({
        link: LINK,
        resolved: false,
        goal: null,
        cardNumber: null,
        cardNumberMask: null,
        ownerName: null
      })
    })

    it('refuses a link on a host that is not NovaPay’s', async () => {
      await expect(
        service.resolve(BankProvider.NOVAPAY, 'https://e-com.novapay.ua.attacker.test/case/x')
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(bankScraperApi.fetchNovaPayCase).not.toHaveBeenCalled()
    })
  })

  describe('PUMB moneyboxes', () => {
    it('reports the masked card and never presents it as a card', async () => {
      const result = await service.resolve(BankProvider.PUMB, BOX_LINK)

      expect(result.cardNumberMask).toBe('53552800****0000')
      // A mask has four digits missing and cannot be paid into. Anything that
      // read this as the account would be paying nobody.
      expect(result.cardNumber).toBeNull()
    })

    it('asks for the moneybox the link names', async () => {
      await service.resolve(BankProvider.PUMB, BOX_LINK)

      expect(bankScraperApi.fetchPumbBox).toHaveBeenCalledWith(
        '7df8cc1b-4b6d-440e-8e65-c0bee6a18821'
      )
    })

    /** It can never receive the money, so this one is a verdict, not a hiccup. */
    it('refuses a closed moneybox', async () => {
      bankScraperApi.fetchPumbBox.mockResolvedValue(moneybox({ status: 'CLOSED' }))

      await expect(service.resolve(BankProvider.PUMB, BOX_LINK)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    /**
     * The mask and the goal are conveniences, exactly as PrivatBank's card is.
     * A PUMB outage costs the pre-checks, not the order.
     */
    it('still resolves the link when PUMB cannot be read', async () => {
      bankScraperApi.fetchPumbBox.mockRejectedValue(new Error('502'))

      const result = await service.resolve(BankProvider.PUMB, BOX_LINK)

      expect(result).toEqual({
        link: BOX_LINK,
        resolved: false,
        goal: null,
        cardNumber: null,
        cardNumberMask: null,
        ownerName: null
      })
    })
  })

  describe('links that need no resolving', () => {
    /**
     * The common case by volume. A network call here would put a bank's
     * availability in the path of every order creation, for nothing.
     */
    /**
     * A link that already carries a `box_id` needs no redirect — but the
     * moneybox behind it is still read, because that record is what names the
     * owner, the target and the masked card.
     */
    it('leaves a usable PUMB link alone, and still reads the moneybox', async () => {
      const result = await service.resolve(BankProvider.PUMB, BOX_LINK)

      expect(result).toEqual({
        link: BOX_LINK,
        resolved: false,
        goal: 80_000,
        cardNumber: null,
        cardNumberMask: '53552800****0000',
        ownerName: 'Іван П.'
      })
      // No redirect followed: the link was already the moneybox's own.
      expect(workerGet).not.toHaveBeenCalled()
      expect(workerPost).not.toHaveBeenCalled()
    })

    it('trims whitespace off a pasted link', async () => {
      const result = await service.resolve(BankProvider.PUMB, `  ${BOX_LINK}\n`)

      expect(result.link).toBe(BOX_LINK)
    })
  })

  describe('PUMB short links', () => {
    /** The feature, in one test: the app's share link becomes a scrapeable one. */
    it('follows the 301 to the page carrying the box_id', async () => {
      workerGet.mockResolvedValueOnce(redirectTo(BOX_LINK))

      const result = await service.resolve(BankProvider.PUMB, SHORT_LINK)

      expect(result).toMatchObject({ link: BOX_LINK, resolved: true, goal: 80_000 })
      expect(workerGet).toHaveBeenCalledTimes(1)
    })

    /**
     * PUMB's chain carries on to `frames2.payhub.com.ua`, but the box_id is
     * already in hand — and `frames2` reads as a load-balancer target rather
     * than a stable address to persist.
     */
    it('stops at the first usable link rather than walking the whole chain', async () => {
      workerGet.mockResolvedValueOnce(redirectTo(BOX_LINK))

      const result = await service.resolve(BankProvider.PUMB, SHORT_LINK)

      expect(result.link).toBe(BOX_LINK)
      expect(result.link).not.toContain('frames2')
      expect(workerGet).toHaveBeenCalledTimes(1)
    })

    it('resolves a Location sent as a relative path', async () => {
      workerGet.mockResolvedValueOnce(redirectTo('/moneybox?box_id=abc'))

      const result = await service.resolve(BankProvider.PUMB, SHORT_LINK)

      expect(result.link).toBe('https://mobile-app.pumb.ua/moneybox?box_id=abc')
    })

    it('reports a chain that never reaches a box_id', async () => {
      workerGet.mockResolvedValue(noRedirect)

      await expect(service.resolve(BankProvider.PUMB, SHORT_LINK)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('gives up on a redirect loop instead of spinning', async () => {
      workerGet.mockResolvedValue(redirectTo('https://mobile-app.pumb.ua/loop'))

      await expect(service.resolve(BankProvider.PUMB, SHORT_LINK)).rejects.toBeInstanceOf(
        BadRequestException
      )
      // Bounded by MAX_REDIRECTS rather than running until the timeout.
      expect(workerGet.mock.calls.length).toBeLessThanOrEqual(5)
    })

    it('reports a bank that will not answer', async () => {
      workerGet.mockRejectedValue(new Error('ETIMEDOUT'))

      await expect(service.resolve(BankProvider.PUMB, SHORT_LINK)).rejects.toBeInstanceOf(
        BadGatewayException
      )
    })
  })

  describe('Monobank share links', () => {
    const SHARE_LINK = 'https://send.monobank.ua/jar/7UzUVw4H2J'
    const EXT_JAR_ID = '5eYPgaHTdBoK1MKRgwyQkexKkMMoLkT6'

    /**
     * The feature. `api.monobank.ua/bank/jar/7UzUVw4H2J` answers
     * `400 invalid alias` — only the long id works — so the share link is
     * exchanged for a widget URL whose `jar` parameter `extractTargetId` reads.
     */
    it('exchanges the short sendId for the long jar id', async () => {
      workerPost.mockResolvedValueOnce(monoResult({ extJarId: EXT_JAR_ID }))

      const result = await service.resolve(BankProvider.MONO, SHARE_LINK)

      expect(result).toEqual({
        link: `https://send.monobank.ua/widget.html?jar=${EXT_JAR_ID}&sendId=7UzUVw4H2J`,
        resolved: true,
        goal: null,
        // Monobank's record names no card — the jar's own card number appears
        // on the share screen and in no public record.
        cardNumber: null,
        // Nor a masked one: PUMB is the only bank that publishes a partial card.
        cardNumberMask: null,
        // Unreachable in this case; see the jar-record block below.
        ownerName: null,
      })
    })

    /**
     * The handshake names the owner itself, masked to a first name and a
     * surname initial. Captured from a live call — it also returns the goal,
     * the status, the jar's IBAN and Monobank's own per-payment limits, so the
     * jar's public record at `api.monobank.ua/bank/jar` has nothing to add and
     * asking it too was a round trip that bought nothing.
     */
    describe('the owner', () => {
      const handshake = (over: Record<string, unknown> = {}) =>
        monoResult({
          extJarId: EXT_JAR_ID,
          jarStatus: 'ACTIVE',
          jarGoal: 100_000,
          ownerName: 'Іван П.',
          name: 'Оплата за послуги',
          currency: '980',
          ...over,
        })

      it('comes from the handshake', async () => {
        workerPost.mockResolvedValueOnce(handshake())

        const result = await service.resolve(BankProvider.MONO, SHARE_LINK)

        expect(result.ownerName).toBe('Іван П.')
      })

      /** One call, not two — the jar record carries the same string. */
      it('costs no second request', async () => {
        workerPost.mockResolvedValueOnce(handshake())

        await service.resolve(BankProvider.MONO, SHARE_LINK)

        expect(bankScraperApi.fetchMonoJar).not.toHaveBeenCalled()
        expect(workerPost).toHaveBeenCalledTimes(1)
      })

      it('is null when the handshake names nobody', async () => {
        workerPost.mockResolvedValueOnce(handshake({ ownerName: undefined }))

        const result = await service.resolve(BankProvider.MONO, SHARE_LINK)

        expect(result.ownerName).toBeNull()
      })

      /** The goal rides on the same response, in kopecks. */
      it('arrives with the goal', async () => {
        workerPost.mockResolvedValueOnce(handshake())

        const result = await service.resolve(BankProvider.MONO, SHARE_LINK)

        expect(result.goal).toBe(100_000)
      })
    })

    it('asks the jar page own endpoint, with a well-formed ephemeral key', async () => {
      workerPost.mockResolvedValueOnce(monoResult({ extJarId: EXT_JAR_ID }))

      await service.resolve(BankProvider.MONO, SHARE_LINK)

      const req = workerPost.mock.calls[0][0]
      expect(req.url).toBe('https://send.monobank.ua/api/handler')
      const body = JSON.parse(req.body as string) as { c: string; clientId: string; Pc: string }
      expect(body).toEqual(expect.objectContaining({ c: 'hello', clientId: '7UzUVw4H2J' }))

      // An uncompressed P-256 point: 0x04 followed by two 32-byte coordinates.
      // The endpoint rejects a payload whose key is not well formed.
      const key = Buffer.from(body.Pc, 'base64')
      expect(key).toHaveLength(65)
      expect(key[0]).toBe(0x04)
    })

    /** Every call gets its own key — it is ephemeral, not a shared constant. */
    it('generates a fresh key per call', async () => {
      workerPost.mockResolvedValue(monoResult({ extJarId: EXT_JAR_ID }))

      await service.resolve(BankProvider.MONO, SHARE_LINK)
      await service.resolve(BankProvider.MONO, SHARE_LINK)

      const [first, second] = workerPost.mock.calls.map(
        (call) => (JSON.parse(call[0].body as string) as { Pc: string }).Pc
      )
      expect(first).not.toBe(second)
    })

    it('reports a jar the endpoint will not identify', async () => {
      workerPost.mockResolvedValueOnce(monoResult({ errCode: '7014' }))

      await expect(service.resolve(BankProvider.MONO, SHARE_LINK)).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it('reports Monobank being unreachable', async () => {
      workerPost.mockRejectedValueOnce(new Error('ETIMEDOUT'))

      await expect(service.resolve(BankProvider.MONO, SHARE_LINK)).rejects.toBeInstanceOf(
        BadGatewayException,
      )
    })

    it('never follows redirects for Monobank — it is an API call, not a hop', async () => {
      workerPost.mockResolvedValueOnce(monoResult({ extJarId: EXT_JAR_ID }))

      await service.resolve(BankProvider.MONO, SHARE_LINK)

      expect(workerGet).not.toHaveBeenCalled()
    })
  })

  describe('what it refuses to fetch', () => {
    /**
     * The endpoint takes a URL from an authenticated user and makes the server
     * request it, so these are the tests that keep it from being a general
     * fetcher aimed at our own network.
     */
    it.each([
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:8000/tma/user/profile',
      'http://127.0.0.1/',
      'https://attacker.test/',
      'https://payhub.com.ua.attacker.test/?box_id=x'
    ])('refuses %p outright, with no request made', async (link) => {
      await expect(service.resolve(BankProvider.PUMB, link)).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(workerGet).not.toHaveBeenCalled()
    })

    it.each(['', 'not-a-url', 'file:///etc/passwd', 'javascript:alert(1)'])(
      'refuses %p as not being a link at all',
      async (link) => {
        await expect(service.resolve(BankProvider.PUMB, link)).rejects.toBeInstanceOf(
          BadRequestException
        )
        expect(workerGet).not.toHaveBeenCalled()
      }
    )

    /**
     * The case auto-following would sail straight through: the *starting* host
     * is legitimate, and it points somewhere else. Every hop is re-checked, so
     * the chain stops here rather than fetching the target.
     */
    it('stops when an allowed host redirects off the allowlist', async () => {
      workerGet.mockResolvedValueOnce(redirectTo('http://169.254.169.254/latest/'))

      await expect(service.resolve(BankProvider.PUMB, SHORT_LINK)).rejects.toBeInstanceOf(
        BadRequestException
      )
      // The redirect was read, but never followed.
      expect(workerGet).toHaveBeenCalledTimes(1)
      expect(workerGet).not.toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('169.254.169.254') })
      )
    })

    it('catches a link pasted under the wrong bank before an order is made', async () => {
      await expect(
        service.resolve(BankProvider.PUMB, 'https://send.monobank.ua/jar/7UzUVw4H2J')
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(service.resolve(BankProvider.MONO, SHORT_LINK)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })
  })

  describe('request shape', () => {
    it('reads each hop as a single GET on the pool channel, never chasing the redirect itself', async () => {
      workerGet.mockResolvedValueOnce(redirectTo(BOX_LINK))

      await service.resolve(BankProvider.PUMB, SHORT_LINK)

      // The worker never follows redirects, so the hop goes out as one plain GET
      // and `followRedirects` is the only thing that advances the chain.
      expect(workerGet).toHaveBeenCalledWith(
        expect.objectContaining({ url: SHORT_LINK, method: ScraperWorkerMethod.GET })
      )
    })

    it('bounds every hop with a response-size cap', async () => {
      workerGet.mockResolvedValueOnce(redirectTo(BOX_LINK))

      await service.resolve(BankProvider.PUMB, SHORT_LINK)

      // 64 KB: above any redirect body, below a rendered page, so a chain that
      // ends on a real 200 is refused rather than downloaded.
      expect(workerGet.mock.calls[0][0].maxBytes).toBe(64 * 1024)
    })
  })
})
