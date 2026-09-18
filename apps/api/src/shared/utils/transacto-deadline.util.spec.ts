import { payerDeadlineFrom, payerWindowMs } from './transacto-deadline.util'

/**
 * The shape of a Transacto order's two timestamps, with invented values.
 *
 * Structure only: the pair below is a six-minute window because that is what
 * the API's own shape produces, and nothing here is a real order.
 */
const SIX_MINUTES = {
  datetime: '2026-01-02 03:04:05',
  deadline: '2026-01-02 03:10:05'
}

describe('payerWindowMs', () => {
  it('reads the window between the two timestamps', () => {
    expect(payerWindowMs(SIX_MINUTES)).toBe(6 * 60 * 1000)
  })

  /**
   * The reason the function returns a *difference* and never an instant.
   *
   * Transacto states neither timestamp's zone, and this repository already
   * knows the two surfaces of that host disagree — the panel's tables are UTC+3
   * while its JSON is UTC. Shifting both timestamps by any amount must not move
   * the answer, because that is the property the whole design leans on.
   */
  it('is unchanged by the zone the pair is written in', () => {
    const shifted = {
      datetime: '2026-01-02 06:04:05',
      deadline: '2026-01-02 06:10:05'
    }

    expect(payerWindowMs(shifted)).toBe(payerWindowMs(SIX_MINUTES))
  })

  it('survives a window that crosses midnight', () => {
    expect(
      payerWindowMs({ datetime: '2026-01-02 23:57:00', deadline: '2026-01-03 00:03:00' })
    ).toBe(6 * 60 * 1000)
  })

  it.each([
    ['a missing deadline', { datetime: SIX_MINUTES.datetime, deadline: null }],
    ['a missing creation time', { datetime: undefined, deadline: SIX_MINUTES.deadline }],
    ['an ISO string, which is not the format observed', {
      datetime: '2026-01-02T03:04:05Z',
      deadline: '2026-01-02T03:10:05Z'
    }],
    ['a date with no time at all', { datetime: '2026-01-02', deadline: '2026-01-02' }]
  ])('refuses %s rather than half-reading it', (_case, order) => {
    expect(payerWindowMs(order)).toBeNull()
  })

  /**
   * A deadline at or before the creation is a contradiction, not a short
   * window. Accepting it would mark the order overdue the moment it arrived,
   * disputing a payment nobody has had a chance to make and stopping a terminal
   * with nothing wrong with it.
   */
  it.each([
    ['equal to', SIX_MINUTES.datetime],
    ['before', '2026-01-02 03:00:00']
  ])('refuses a deadline %s the creation time', (_case, deadline) => {
    expect(payerWindowMs({ datetime: SIX_MINUTES.datetime, deadline })).toBeNull()
  })
})

describe('payerDeadlineFrom', () => {
  it('anchors the window to our own clock, not to their wall time', () => {
    const arrivedAt = new Date('2026-06-01T12:00:00.000Z')

    expect(payerDeadlineFrom(SIX_MINUTES, arrivedAt)).toEqual(
      new Date('2026-06-01T12:06:00.000Z')
    )
  })

  it('is null when the delivery carried nothing usable', () => {
    expect(payerDeadlineFrom({ datetime: null, deadline: null }, new Date())).toBeNull()
  })
})
