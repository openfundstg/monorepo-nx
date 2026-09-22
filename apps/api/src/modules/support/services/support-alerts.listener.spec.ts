import { SaleMethod } from '@transacto/contracts'
import { SupportAlertsListener } from './support-alerts.listener'
import type { SupportConfigService } from './support-config.service'
import type { TelegramBotApiService } from './telegram-bot.api.service'
import type { TmaSaleTailReachedEvent } from 'src/shared/interfaces'

const GROUP_ID = -1_002_233_445_566

/**
 * Invented, Luhn-valid, and a monobank BIN kept because the grouping is what is
 * being asserted. Nothing in this repository holds a real card — see the root
 * `CLAUDE.md`.
 */
const CARD = '4441110000005500'

const tail = (overrides: Partial<TmaSaleTailReachedEvent> = {}): TmaSaleTailReachedEvent => ({
  saleId: '68e1f2a3b4c5d6e7f8a9b0c1',
  publicId: 'Z38SL69F',
  telegramId: 885_140,
  saleMethod: SaleMethod.CARD,
  tailKopecks: 6_000,
  fiatAmount: 96_000,
  receivedAmount: 90_000,
  payoutTarget: CARD,
  ...overrides
})

describe('SupportAlertsListener', () => {
  let telegramApi: { sendMessage: jest.Mock }
  let config: { groupId: number | null }
  let listener: SupportAlertsListener

  const build = () =>
    new SupportAlertsListener(
      telegramApi as unknown as TelegramBotApiService,
      config as unknown as SupportConfigService
    )

  beforeEach(() => {
    telegramApi = { sendMessage: jest.fn().mockResolvedValue(undefined) }
    config = { groupId: GROUP_ID }
    listener = build()
  })

  const sent = (): string => telegramApi.sendMessage.mock.calls[0]?.[0]?.text ?? ''

  describe('a sale asking for its tail to be transferred', () => {
    it('names the sum, the sale and the user', async () => {
      await listener.onSaleTailReached(tail())

      expect(telegramApi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chat_id: GROUP_ID })
      )
      expect(sent()).toContain('Z38SL69F')
      expect(sent()).toContain('60.00')
      expect(sent()).toContain('885140')
    })

    /**
     * **The one message in this file that carries a card number**, and the
     * grouping is the point: it is read off a phone and typed into a banking
     * app, which is done in fours. See the method's own note for why the
     * exception was taken at all.
     */
    it('spells the card out in fours', async () => {
      await listener.onSaleTailReached(tail())

      expect(sent()).toContain('4441 1100 0000 5500')
    })

    it('names the jar link instead on a jar sale', async () => {
      await listener.onSaleTailReached(
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
      await listener.onSaleTailReached(tail({ payoutTarget: null }))

      expect(telegramApi.sendMessage).toHaveBeenCalled()
      expect(sent()).toContain('панелі')
      expect(sent()).not.toContain('4441')
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

      await expect(listener.onSaleTailReached(tail())).resolves.toBeUndefined()
    })
  })
})
