import { resolveSupportBotToken } from './support-bot-identity.util'

const MINI_APP = '111:mini-app-bot'
const SUPPORT = '222:support-bot'

describe('resolveSupportBotToken', () => {
  /** The setup the module was written for: one bot doing both jobs. */
  it('falls back to the Mini App’s bot when support has no token of its own', () => {
    expect(resolveSupportBotToken(undefined, MINI_APP)).toBe(MINI_APP)
  })

  it('treats an empty or blank variable as unset', () => {
    expect(resolveSupportBotToken('   ', MINI_APP)).toBe(MINI_APP)
  })

  /**
   * The failure this exists to prevent: a support bot's token in
   * `TELEGRAM_BOT_TOKEN` makes `TmaAuthService` verify `initData` against the
   * wrong key, and every Mini App request 401s with `Invalid initData hash`.
   */
  it('keeps the two bots apart when support has its own token', () => {
    expect(resolveSupportBotToken(SUPPORT, MINI_APP)).toBe(SUPPORT)
  })
})
