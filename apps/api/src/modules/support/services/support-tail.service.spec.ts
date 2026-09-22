import { ConflictException, NotFoundException } from '@nestjs/common'
import { ERROR, SaleMethod } from '@transacto/contracts'
import { SupportTailService } from './support-tail.service'
import type { SupportConfigService } from './support-config.service'
import type { TelegramBotApiService } from './telegram-bot.api.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { SaleTailService } from 'src/modules/telegram-mini-app'
import type { TelegramMessage, TmaSaleTailReachedEvent } from 'src/shared/interfaces'

const GROUP_ID = -1_002_233_445_566
const ALERT_ID = 4_411
const SALE_ID = '68e1f2a3b4c5d6e7f8a9b0c1'

/**
 * Invented, Luhn-valid, and a monobank BIN kept because the grouping is what is
 * being asserted. Nothing in this repository holds a real card — see the root
 * `CLAUDE.md`.
 */
const CARD = '4441110000005500'

const tail = (overrides: Partial<TmaSaleTailReachedEvent> = {}): TmaSaleTailReachedEvent => ({
  saleId: SALE_ID,
  publicId: 'Z38SL69F',
  telegramId: 885_140,
  saleMethod: SaleMethod.CARD,
  tailKopecks: 6_000,
  fiatAmount: 96_000,
  receivedAmount: 90_000,
  payoutTarget: CARD,
  ...overrides
})

const reply = (text: string): TelegramMessage =>
  ({
    message_id: 9_001,
    date: 1_780_000_000,
    from: { id: 99, is_bot: false, first_name: 'Оператор' },
    chat: { id: GROUP_ID },
    reply_to_message: { message_id: ALERT_ID },
    text
  }) as unknown as TelegramMessage

/**
 * Both halves of one exchange: the ask that goes into the operators' group, and
 * the `+` that answers it.
 *
 * The answer is what the assertions here are mostly about, because it is
 * load-bearing rather than polite — until it is written nothing is on its way,
 * and once it is, the seller can no longer end their own sale.
 */
describe('SupportTailService', () => {
  let telegramApi: { sendMessage: jest.Mock }
  let config: { groupId: number | null }
  let saleDb: { rememberTailAlert: jest.Mock; findByTailAlert: jest.Mock }
  let tails: { claim: jest.Mock }
  let service: SupportTailService

  const build = () =>
    new SupportTailService(
      telegramApi as unknown as TelegramBotApiService,
      config as unknown as SupportConfigService,
      saleDb as unknown as TmaSaleDbService,
      tails as unknown as SaleTailService
    )

  beforeEach(() => {
    telegramApi = { sendMessage: jest.fn().mockResolvedValue({ message_id: ALERT_ID }) }
    config = { groupId: GROUP_ID }
    saleDb = {
      rememberTailAlert: jest.fn().mockResolvedValue(true),
      findByTailAlert: jest.fn().mockResolvedValue({
        _id: { toString: () => SALE_ID },
        publicId: 'Z38SL69F'
      })
    }
    tails = { claim: jest.fn().mockResolvedValue(true) }
    service = build()
  })

  const sent = (index = 0): string =>
    telegramApi.sendMessage.mock.calls[index]?.[0]?.text ?? ''

  describe('asking for the transfer', () => {
    it('names the sum, the sale and the user', async () => {
      await service.onSaleTailReached(tail())

      expect(telegramApi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chat_id: GROUP_ID })
      )
      expect(sent()).toContain('Z38SL69F')
      expect(sent()).toContain('60.00')
      expect(sent()).toContain('885140')
    })

    /**
     * **The one message in this module that carries a card number**, and the
     * grouping is the point: it is read off a phone and typed into a banking
     * app, which is done in fours. See the method's own note for why the
     * exception was taken at all.
     */
    it('spells the card out in fours', async () => {
      await service.onSaleTailReached(tail())

      expect(sent()).toContain('4441 1100 0000 5500')
    })

    it('names the jar link instead on a jar sale', async () => {
      await service.onSaleTailReached(
        tail({ saleMethod: SaleMethod.JAR, payoutTarget: 'https://example.test/jar/abc' })
      )

      expect(sent()).toContain('https://example.test/jar/abc')
      expect(sent()).not.toContain('Картка')
    })

    /**
     * An alert that cannot name a destination is still worth sending — the sum
     * and the sale are what make it actionable — but it must say so rather than
     * leaving a line somebody has to interpret.
     */
    it('says where to look when the destination could not be read', async () => {
      await service.onSaleTailReached(tail({ payoutTarget: null }))

      expect(telegramApi.sendMessage).toHaveBeenCalled()
      expect(sent()).toContain('панелі')
      expect(sent()).not.toContain('4441')
    })

    /** The instruction is the feature: transferring before the `+` is the bug. */
    it('asks for the `+` before anybody transfers anything', async () => {
      await service.onSaleTailReached(tail())

      expect(sent()).toContain('«+»')
      expect(sent()).toContain('Прийнято')
    })

    /** A reply finds its sale by this id and by nothing else. */
    it('records the message it went out as', async () => {
      await service.onSaleTailReached(tail())

      expect(saleDb.rememberTailAlert).toHaveBeenCalledWith(SALE_ID, ALERT_ID)
    })

    /** A workspace with no support group is inert, not broken. */
    it('says nothing when no group is configured', async () => {
      config = { groupId: null }

      await build().onSaleTailReached(tail())

      expect(telegramApi.sendMessage).not.toHaveBeenCalled()
    })

    /**
     * An alert that throws would take down the pass that settles other people's
     * money. A message nobody sees is the lesser failure, and it is the one this
     * class is written to produce.
     */
    it('swallows a Telegram failure rather than breaking the settlement pass', async () => {
      telegramApi.sendMessage.mockRejectedValue(new Error('429 Too Many Requests'))

      await expect(service.onSaleTailReached(tail())).resolves.toBeUndefined()
    })
  })

  describe('taking it on', () => {
    it('claims the sale the reply answers', async () => {
      await service.handleReply(reply('+'), ALERT_ID)

      expect(saleDb.findByTailAlert).toHaveBeenCalledWith(ALERT_ID)
      expect(tails.claim).toHaveBeenCalledWith(SALE_ID)
    })

    /**
     * Silence has to mean "not taken", so a claim that went through always says
     * so — and says it under the `+` that said it, because several alerts can be
     * open in the same thread at once.
     */
    it('answers under the reply that took it', async () => {
      await service.handleReply(reply('+'), ALERT_ID)

      expect(telegramApi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: GROUP_ID,
          reply_parameters: expect.objectContaining({ message_id: 9_001 })
        })
      )
      expect(sent()).toContain('Прийнято')
      expect(sent()).toContain('Z38SL69F')
    })

    /** Somebody else got there first, which is ordinary and said differently. */
    it('says so when it was already taken', async () => {
      tails.claim.mockResolvedValue(false)

      await service.handleReply(reply('+'), ALERT_ID)

      expect(sent()).toContain('уже взяли')
      expect(sent()).not.toContain('Прийнято')
    })

    /** The one answer that means *do not transfer*. */
    it.each([
      ['no longer waiting', new ConflictException(ERROR.SALE.TAIL_NOT_WAITING)],
      ['gone', new NotFoundException(ERROR.SALE.NOT_FOUND)]
    ])('tells them not to transfer when the sale is %s', async (_, error) => {
      tails.claim.mockRejectedValue(error)

      await service.handleReply(reply('+'), ALERT_ID)

      expect(sent()).toContain('Не переказуйте')
    })

    /**
     * "Try again" rather than "no": saying "do not transfer" where the truth is
     * "ask me again" leaves a seller waiting for a transfer nobody makes.
     */
    it('asks them to try again on anything else', async () => {
      tails.claim.mockRejectedValue(new Error('mongo is having a day'))

      await service.handleReply(reply('+'), ALERT_ID)

      expect(sent()).toContain('ще раз')
    })

    /** Operators talk in that thread. A sentence containing a plus is a sentence. */
    it.each(['+1', 'ок +', 'беру', ''])('ignores %p', async (text) => {
      await service.handleReply(reply(text), ALERT_ID)

      expect(saleDb.findByTailAlert).not.toHaveBeenCalled()
      expect(telegramApi.sendMessage).not.toHaveBeenCalled()
    })

    /** Surrounding whitespace is a phone keyboard, not a different answer. */
    it('takes a `+` with whitespace around it', async () => {
      await service.handleReply(reply('  +  '), ALERT_ID)

      expect(tails.claim).toHaveBeenCalledWith(SALE_ID)
    })

    /** A reply to anything else in General is not ours, and gets no answer. */
    it('says nothing when the reply is not to an alert', async () => {
      saleDb.findByTailAlert.mockResolvedValue(null)

      await service.handleReply(reply('+'), 12)

      expect(tails.claim).not.toHaveBeenCalled()
      expect(telegramApi.sendMessage).not.toHaveBeenCalled()
    })

    /** An exception escaping a webhook handler is an update redelivered forever. */
    it('never throws', async () => {
      tails.claim.mockRejectedValue(new Error('down'))
      telegramApi.sendMessage.mockRejectedValue(new Error('also down'))

      await expect(service.handleReply(reply('+'), ALERT_ID)).resolves.toBeUndefined()
    })
  })
})
