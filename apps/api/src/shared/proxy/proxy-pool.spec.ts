import type { Logger } from '@nestjs/common'
import { ProxyPool } from './proxy-pool'

const logger = () => ({ debug: jest.fn(), warn: jest.fn() }) as unknown as Logger

const pool = (raw: string) => new ProxyPool('TEST_URLS', raw, logger())

describe('ProxyPool — reading the configured list', () => {
  it('is not configured when the list is empty', () => {
    expect(pool('').isConfigured).toBe(false)
    expect(pool('   ,  , ').size).toBe(0)
    expect(pool('').agent()).toBeUndefined()
  })

  it('adds the scheme an entry left out', () => {
    expect(pool('host:10000').agent()?.proxy.href).toBe('http://host:10000/')
  })

  it('keeps a scheme that is already there, https included', () => {
    expect(pool('https://host:10000').agent()?.proxy.protocol).toBe('https:')
  })

  /**
   * A value quoted in an env file arrives with the quotes attached, and the
   * credential then decodes with a `"` inside it — every request answers `407`,
   * which reads as a wrong password rather than as a quoting mistake. An hour
   * went into that once already, from the other direction.
   */
  it('strips quotes around an entry', () => {
    const agent = pool('"http://user:pass@host:10000"').agent()

    expect(agent?.proxy.username).toBe('user')
    expect(agent?.proxy.host).toBe('host:10000')
  })

  it('splits on commas and ignores the gaps', () => {
    expect(pool('a:1, b:2 ,, c:3').size).toBe(3)
  })
})

describe('ProxyPool — moving between addresses', () => {
  it('hands out the active address until told to move', () => {
    const p = pool('a:1,b:2')

    expect(p.agent()?.proxy.host).toBe('a:1')
    expect(p.agent()?.proxy.host).toBe('a:1')

    p.rotate('because', true)

    expect(p.agent()?.proxy.host).toBe('b:2')
  })

  it('wraps around the end of the list', () => {
    const p = pool('a:1,b:2')

    p.rotate('one', true)
    p.rotate('two', true)

    expect(p.agent()?.proxy.host).toBe('a:1')
  })

  /** Nothing to move to, so a caller asking must not corrupt the index. */
  it('does nothing with a single address', () => {
    const p = pool('only:1')

    p.rotate('because', true)

    expect(p.agent()?.proxy.host).toBe('only:1')
  })

  /**
   * A burst of failures arriving together must not walk the whole list. The
   * caller that has already decided the address is at fault passes `force`.
   */
  it('ignores an unforced rotation inside the cooldown', () => {
    const p = pool('a:1,b:2,c:3')

    p.rotate('first', true)
    p.rotate('immediately after', false)

    expect(p.agent()?.proxy.host).toBe('b:2')
  })
})

describe('ProxyPool — what reaches the log', () => {
  it('never puts the password in a line', () => {
    const log = logger()
    new ProxyPool('TEST_URLS', 'http://user:hunter2@host:10000', log).agent('a-session')

    const lines = (log.debug as jest.Mock).mock.calls.flat().join(' ')

    expect(lines).not.toContain('hunter2')
    expect(lines).toContain('user:***@host:10000')
    expect(lines).toContain('TEST_URLS')
  })

  /** A pool names the variable it was filled from, so an empty-pool line says which. */
  it('names the source it was filled from when rotating', () => {
    const log = logger()
    new ProxyPool('PROXY_URLS', 'a:1,b:2', log).rotate('because', true)

    expect((log.warn as jest.Mock).mock.calls.flat().join(' ')).toContain('PROXY_URLS')
  })
})
