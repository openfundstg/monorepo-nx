import { ERROR } from '@transacto/contracts'

/** Every leaf in `ERROR`, flattened to `DOMAIN.NAME → code`. */
const allCodes = (): { path: string; code: number }[] =>
  Object.entries(ERROR).flatMap(([domain, leaves]) =>
    Object.entries(leaves as Record<string, { code: number }>).map(([name, leaf]) => ({
      path: `${domain}.${name}`,
      code: leaf.code,
    })),
  )

describe('ERROR codes', () => {
  /**
   * Clients switch on `code`, so two errors sharing one is not a tidiness
   * problem — it is a user being shown the wrong sentence. It happened:
   * `CARD_MISMATCH` was added at 1311, which `JAR_NOT_ACTIVE` already held, so
   * a card mismatch would have told the user their jar was closed.
   *
   * Nothing else could catch it. Both sides type-check, both build, and the
   * dictionaries key on the number rather than the name.
   */
  it('are unique across every domain', () => {
    const byCode = new Map<number, string[]>()

    for (const { path, code } of allCodes()) {
      byCode.set(code, [...(byCode.get(code) ?? []), path])
    }

    const collisions = [...byCode.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([code, paths]) => `${code}: ${paths.join(' and ')}`)

    expect(collisions).toEqual([])
  })

  /** Domains are blocked in hundreds; a leaf outside its block is a typo. */
  it('sit inside their domain’s block', () => {
    const blocks: Record<string, number> = {
      AUTH: 1000,
      TMA_AUTH: 1100,
      DEPOSIT: 1200,
      SALE: 1300,
      TERMINAL: 1400,
      ALERT: 1900,
    }

    for (const { path, code } of allCodes()) {
      const [domain] = path.split('.')
      const block = blocks[domain]
      if (block === undefined) continue

      expect({ path, inBlock: code >= block && code < block + 100 }).toEqual({
        path,
        inBlock: true,
      })
    }
  })

  it('carry a developer-facing message', () => {
    for (const [domain, leaves] of Object.entries(ERROR)) {
      for (const [name, leaf] of Object.entries(leaves as Record<string, { message: string }>)) {
        expect({ at: `${domain}.${name}`, hasMessage: leaf.message.length > 0 }).toEqual({
          at: `${domain}.${name}`,
          hasMessage: true,
        })
      }
    }
  })
})
