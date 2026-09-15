import { SupportMessageLinkDbService } from './support-message-link-db.service'
import type { Model } from 'mongoose'
import type { SupportMessageLinkDocument } from '../schemas'

const USER_ID = 501_234_567
const THREAD_ID = 42

const duplicateOn = (field: string) =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern: { [field]: 1 } })

describe('SupportMessageLinkDbService', () => {
  let create: jest.Mock
  let findOne: jest.Mock
  let service: SupportMessageLinkDbService

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({})
    findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) })
    service = new SupportMessageLinkDbService({ create, findOne } as unknown as Model<
      SupportMessageLinkDocument
    >)
  })

  it('records both ids of one message', async () => {
    await service.link(USER_ID, THREAD_ID, 7, 101)

    expect(create).toHaveBeenCalledWith({
      telegramId: USER_ID,
      messageThreadId: THREAD_ID,
      userMessageId: 7,
      groupMessageId: 101
    })
  })

  /**
   * A duplicate means the same message was relayed twice — a redelivery
   * Telegram already handled. Throwing here would turn that into a 5xx and buy
   * another redelivery of a message that is already through.
   */
  it.each([['userMessageId'], ['groupMessageId']])(
    'swallows a duplicate on %s',
    async (field: string) => {
      create.mockRejectedValueOnce(duplicateOn(field))

      await expect(service.link(USER_ID, THREAD_ID, 7, 101)).resolves.toBeUndefined()
    }
  )

  /** Any other write failure is a real one and must not be mistaken for a retry. */
  it('rethrows anything that is not a duplicate', async () => {
    create.mockRejectedValueOnce(new Error('mongo is down'))

    await expect(service.link(USER_ID, THREAD_ID, 7, 101)).rejects.toThrow('mongo is down')
  })

  describe('lookups', () => {
    it('translates a user-chat id into its group twin', async () => {
      findOne.mockReturnValue({ lean: () => Promise.resolve({ groupMessageId: 101 }) })

      await expect(service.findGroupMessageId(USER_ID, 7)).resolves.toBe(101)
      expect(findOne).toHaveBeenCalledWith({ telegramId: USER_ID, userMessageId: 7 })
    })

    it('translates a group id into its user-chat twin', async () => {
      findOne.mockReturnValue({ lean: () => Promise.resolve({ userMessageId: 7 }) })

      await expect(service.findUserMessageId(101)).resolves.toBe(7)
    })

    /** An unlinked message — the bot's own, or one older than the TTL. */
    it('answers null rather than a number nobody stored', async () => {
      await expect(service.findUserMessageId(999)).resolves.toBeNull()
    })
  })
})
