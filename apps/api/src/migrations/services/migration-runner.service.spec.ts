import { MigrationRunnerService } from './migration-runner.service'
import type { MigrationDbService } from 'src/modules/repositories/migration-db/services'
import type { Migration } from 'src/migrations/interfaces'

/** A migration that records what was asked of it. */
const migration = (name: string, reversible = true): Migration & { ran: string[] } => {
  const ran: string[] = []

  return {
    name,
    ran,
    up: async () => {
      ran.push('up')
      return `${name} applied`
    },
    ...(reversible
      ? {
          down: async () => {
            ran.push('down')
            return `${name} reversed`
          }
        }
      : {})
  }
}

describe('MigrationRunnerService', () => {
  let db: {
    findApplied: jest.Mock
    record: jest.Mock
    forget: jest.Mock
    acquireLock: jest.Mock
    releaseLock: jest.Mock
    findLock: jest.Mock
  }

  const runnerFor = (migrations: Migration[]) =>
    new MigrationRunnerService(db as unknown as MigrationDbService, migrations)

  beforeEach(() => {
    db = {
      findApplied: jest.fn().mockResolvedValue([]),
      record: jest.fn().mockResolvedValue(undefined),
      forget: jest.fn().mockResolvedValue(undefined),
      // `null` is a lock taken; a string is somebody else holding it.
      acquireLock: jest.fn().mockResolvedValue(null),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      findLock: jest.fn().mockResolvedValue(null)
    }
  })

  describe('up', () => {
    it('runs what has not run, in the order the list states', async () => {
      const first = migration('0001-a')
      const second = migration('0002-b')

      await runnerFor([first, second]).up()

      expect(first.ran).toEqual(['up'])
      expect(second.ran).toEqual(['up'])
      expect(db.record.mock.calls.map(([entry]) => entry.name)).toEqual(['0001-a', '0002-b'])
    })

    it('skips what the record says has already run', async () => {
      db.findApplied.mockResolvedValue([{ name: '0001-a', appliedAt: new Date() }])
      const first = migration('0001-a')
      const second = migration('0002-b')

      await runnerFor([first, second]).up()

      expect(first.ran).toEqual([])
      expect(second.ran).toEqual(['up'])
    })

    /**
     * Order is the whole reason a list exists: a later migration is written
     * against the data an earlier one leaves. Carrying on past a failure would
     * run it against data that never got there.
     */
    it('stops at the first failure and leaves the rest pending', async () => {
      const failing: Migration = {
        name: '0001-a',
        up: async () => {
          throw new Error('boom')
        }
      }
      const second = migration('0002-b')

      await expect(runnerFor([failing, second]).up()).rejects.toThrow('boom')

      expect(second.ran).toEqual([])
      expect(db.record).not.toHaveBeenCalled()
    })

    /**
     * Recorded after the work, never before. A crash halfway leaves the
     * migration pending, which re-runs it — the outcome every migration is
     * written to survive. The reverse ordering would leave it marked done and
     * half applied, which nothing can recover from automatically.
     */
    it('records only once the work is finished', async () => {
      const order: string[] = []
      db.record.mockImplementation(async () => void order.push('record'))

      await runnerFor([
        {
          name: '0001-a',
          up: async () => {
            order.push('work')
            return 'done'
          }
        }
      ]).up()

      expect(order).toEqual(['work', 'record'])
    })

    it('releases the lock even when a migration throws', async () => {
      const failing: Migration = {
        name: '0001-a',
        up: async () => {
          throw new Error('boom')
        }
      }

      await expect(runnerFor([failing]).up()).rejects.toThrow('boom')
      expect(db.releaseLock).toHaveBeenCalled()
    })

    it('refuses to start while another run holds the lock', async () => {
      db.acquireLock.mockResolvedValue('host:42 since 2026-09-04T10:00:00.000Z')
      const only = migration('0001-a')

      await expect(runnerFor([only]).up()).rejects.toThrow(/locked by host:42/)

      expect(only.ran).toEqual([])
      // Not released: it is not ours to release, and clearing somebody else's
      // lock is exactly the mistake `unlock` makes deliberate.
      expect(db.releaseLock).not.toHaveBeenCalled()
    })
  })

  describe('down', () => {
    it('reverses the last applied when none is named', async () => {
      db.findApplied.mockResolvedValue([
        { name: '0001-a', appliedAt: new Date(1) },
        { name: '0002-b', appliedAt: new Date(2) }
      ])
      const first = migration('0001-a')
      const second = migration('0002-b')

      await runnerFor([first, second]).down()

      expect(second.ran).toEqual(['down'])
      expect(first.ran).toEqual([])
      expect(db.forget).toHaveBeenCalledWith('0002-b')
    })

    it('refuses one that cannot be reversed', async () => {
      db.findApplied.mockResolvedValue([{ name: '0001-a', appliedAt: new Date() }])

      await expect(runnerFor([migration('0001-a', false)]).down()).rejects.toThrow(
        /cannot be reversed/
      )
      expect(db.forget).not.toHaveBeenCalled()
    })

    it('refuses one that never ran', async () => {
      await expect(runnerFor([migration('0001-a')]).down('0001-a')).rejects.toThrow(
        /has not been applied/
      )
    })

    it('refuses a name it does not know', async () => {
      db.findApplied.mockResolvedValue([{ name: '0009-gone', appliedAt: new Date() }])

      await expect(runnerFor([migration('0001-a')]).down('0009-gone')).rejects.toThrow(
        /No migration named/
      )
    })
  })

  describe('status', () => {
    it('reports each migration, whether it ran, and whether it can be undone', async () => {
      db.findApplied.mockResolvedValue([{ name: '0001-a', appliedAt: new Date(7) }])

      const rows = await runnerFor([migration('0001-a'), migration('0002-b', false)]).status()

      expect(rows).toEqual([
        { name: '0001-a', appliedAt: new Date(7), reversible: true },
        { name: '0002-b', appliedAt: null, reversible: false }
      ])
    })
  })

  /** The one thing the running API does with migrations: notice. */
  describe('on boot', () => {
    it('says nothing when everything has run', async () => {
      db.findApplied.mockResolvedValue([{ name: '0001-a', appliedAt: new Date() }])
      const runner = runnerFor([migration('0001-a')])
      const warn = jest.spyOn(runner['logger'], 'warn').mockImplementation()

      await runner.onApplicationBootstrap()

      expect(warn).not.toHaveBeenCalled()
    })

    it('names what is pending', async () => {
      const runner = runnerFor([migration('0001-a')])
      const warn = jest.spyOn(runner['logger'], 'warn').mockImplementation()

      await runner.onApplicationBootstrap()

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('0001-a'))
    })

    /** A boot must not fail over a courtesy check. */
    it('survives a database that cannot answer', async () => {
      db.findApplied.mockRejectedValue(new Error('mongo is down'))
      const runner = runnerFor([migration('0001-a')])
      jest.spyOn(runner['logger'], 'warn').mockImplementation()

      await expect(runner.onApplicationBootstrap()).resolves.toBeUndefined()
    })
  })
})
