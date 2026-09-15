import { BankProvider } from '@transacto/contracts'
import {
  isAllowedDropLinkHost,
  isCanonicalDropLink,
  isHostWithinDomain,
  parseDropLink
} from './drop-link.util'

/** Shorthand — every helper here takes a parsed URL. */
const url = (value: string): URL => {
  const parsed = parseDropLink(value)
  if (!parsed) throw new Error(`not a usable URL: ${value}`)

  return parsed
}

describe('parseDropLink', () => {
  it('accepts http and https', () => {
    expect(parseDropLink('https://send.monobank.ua/jar/ABC')).not.toBeNull()
    expect(parseDropLink('http://send.monobank.ua/jar/ABC')).not.toBeNull()
  })

  it('trims surrounding whitespace, which pasted links routinely carry', () => {
    expect(parseDropLink('  https://send.monobank.ua/jar/ABC \n')?.hostname).toBe(
      'send.monobank.ua'
    )
  })

  it.each(['', 'not a url', 'send.monobank.ua/jar/ABC', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'rejects %p',
    (value) => {
      expect(parseDropLink(value)).toBeNull()
    }
  )
})

describe('isHostWithinDomain', () => {
  it('matches the domain itself and its subdomains', () => {
    expect(isHostWithinDomain('pumb.ua', 'pumb.ua')).toBe(true)
    expect(isHostWithinDomain('mobile-app.pumb.ua', 'pumb.ua')).toBe(true)
    expect(isHostWithinDomain('MOBILE-APP.PUMB.UA', 'pumb.ua')).toBe(true)
  })

  /**
   * The reason this is not a substring check. Both of these contain the
   * allowed domain and are controlled by somebody else entirely — letting
   * either through would turn the resolver into an open redirect follower.
   */
  it.each([
    ['evil-pumb.ua', 'pumb.ua'],
    ['pumb.ua.attacker.test', 'pumb.ua'],
    ['payhub.com.ua.attacker.test', 'payhub.com.ua'],
    ['notpayhub.com.ua', 'payhub.com.ua']
  ])('rejects %p against %p', (hostname, domain) => {
    expect(isHostWithinDomain(hostname, domain)).toBe(false)
  })
})

describe('isAllowedDropLinkHost', () => {
  it('lets PUMB start from either the app short link or payhub', () => {
    expect(isAllowedDropLinkHost(url('https://mobile-app.pumb.ua/1MMsg'), BankProvider.PUMB)).toBe(
      true
    )
    expect(
      isAllowedDropLinkHost(url('https://frames.payhub.com.ua/moneybox?box_id=x'), BankProvider.PUMB)
    ).toBe(true)
  })

  it('keeps the banks apart, so a link pasted under the wrong one is caught', () => {
    expect(isAllowedDropLinkHost(url('https://send.monobank.ua/jar/ABC'), BankProvider.PUMB)).toBe(
      false
    )
    expect(isAllowedDropLinkHost(url('https://mobile-app.pumb.ua/1MMsg'), BankProvider.MONO)).toBe(
      false
    )
    expect(
      isAllowedDropLinkHost(url('https://next.privat24.ua/send/ABC'), BankProvider.MONO)
    ).toBe(false)
  })

  it('lets NovaPay start from a case link, and from nothing else', () => {
    expect(
      isAllowedDropLinkHost(url('https://e-com.novapay.ua/case/Er6QMUgswz'), BankProvider.NOVAPAY)
    ).toBe(true)
    expect(
      isAllowedDropLinkHost(
        url('https://e-com.novapay.ua.attacker.test/case/x'),
        BankProvider.NOVAPAY
      )
    ).toBe(false)
  })

  it('refuses an arbitrary host, which is what stops this fetching our own network', () => {
    expect(isAllowedDropLinkHost(url('http://169.254.169.254/latest/meta-data/'), BankProvider.PUMB))
      .toBe(false)
    expect(isAllowedDropLinkHost(url('http://localhost:8000/tma/user/profile'), BankProvider.PUMB))
      .toBe(false)
  })
})

describe('isCanonicalDropLink', () => {
  describe('PUMB', () => {
    it('is finished only once a box_id is present', () => {
      expect(
        isCanonicalDropLink(
          url('https://frames.payhub.com.ua/moneybox?box_id=7df8cc1b-4b6d-440e-8e65-c0bee6a18821'),
          BankProvider.PUMB
        )
      ).toBe(true)
    })

    /** The share link. It is the whole reason the resolver exists. */
    it('is not finished for the app short link', () => {
      expect(isCanonicalDropLink(url('https://mobile-app.pumb.ua/1MMsg'), BankProvider.PUMB)).toBe(
        false
      )
    })

    it('is not finished for a payhub page carrying no box_id', () => {
      expect(
        isCanonicalDropLink(url('https://frames.payhub.com.ua/moneybox'), BankProvider.PUMB)
      ).toBe(false)
    })
  })

  describe('Monobank', () => {
    /**
     * Only the long `extJarId` is usable, and it lives in the `jar` parameter
     * of the stream-widget URL.
     */
    it('is finished once the jar parameter carries the long id', () => {
      expect(
        isCanonicalDropLink(
          url('https://send.monobank.ua/widget.html?jar=5eYPgaHTdBoK1MKRgwyQkexKkMMoLkT6'),
          BankProvider.MONO
        )
      ).toBe(true)
    })

    /**
     * The share link. Its path segment is the *sendId*, which
     * `api.monobank.ua/bank/jar/<sendId>` answers `400 invalid alias` for — so
     * treating it as finished produced a terminal that could never scrape.
     * `DropLinkResolverService` exchanges it for the long id instead.
     */
    it('is not finished for a share link, whose path holds the short sendId', () => {
      expect(
        isCanonicalDropLink(url('https://send.monobank.ua/jar/7UzUVw4H2J'), BankProvider.MONO)
      ).toBe(false)
    })

    /** The builder page names the id `longJarId`, which the scraper cannot read. */
    it('is not finished for the widget builder URL', () => {
      expect(
        isCanonicalDropLink(
          url('https://send.monobank.ua/widget/builder.html?longJarId=5eYPgaHTdBoK1MKRgwyQkexKkMMoLkT6'),
          BankProvider.MONO
        )
      ).toBe(false)
    })

    it('is not finished for a bare domain', () => {
      expect(isCanonicalDropLink(url('https://send.monobank.ua/'), BankProvider.MONO)).toBe(false)
    })
  })

  /**
   * Nothing to resolve: the page a user pastes is the page the scraper reads.
   * The check is still about the URL — a bare host is not a case.
   */
  describe('NovaPay', () => {
    it('accepts a case link', () => {
      expect(
        isCanonicalDropLink(url('https://e-com.novapay.ua/case/Er6QMUgswz'), BankProvider.NOVAPAY)
      ).toBe(true)
    })

    it('refuses a link with no case on it', () => {
      expect(isCanonicalDropLink(url('https://e-com.novapay.ua/'), BankProvider.NOVAPAY)).toBe(
        false
      )
    })
  })

  describe('PrivatBank', () => {
    it('accepts an envelope link as-is', () => {
      expect(
        isCanonicalDropLink(url('https://next.privat24.ua/send/abc123'), BankProvider.PRIVAT)
      ).toBe(true)
    })

    it('tolerates a trailing slash rather than reading it as an empty hash', () => {
      expect(
        isCanonicalDropLink(url('https://next.privat24.ua/send/abc123/'), BankProvider.PRIVAT)
      ).toBe(true)
    })
  })
})
