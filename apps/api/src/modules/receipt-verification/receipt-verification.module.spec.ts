import { Test } from '@nestjs/testing'
import { ProxyModule } from 'src/shared/proxy'
import { ScraperWorkerModule } from 'src/shared/scraper-worker'
import { ReceiptVerificationModule } from './receipt-verification.module'
import {
  RECEIPT_CODE_STRATEGIES,
  RECEIPT_VERIFICATION_PROVIDERS
} from './receipt-verification.tokens'
import { ReceiptVerificationFacadeService } from './services'
import type { ReceiptCodeStrategy, ReceiptVerificationProvider } from './interfaces'
import { BankProvider } from '@transacto/contracts'

/**
 * Configuration, not code. The facade iterates two injected lists and names no
 * bank and no verifier, which is exactly what makes an empty list a silent
 * failure: every receipt would come back `CODE_NOT_FOUND`, look like a run of
 * unreadable uploads, and nothing would throw.
 */
describe('ReceiptVerificationModule', () => {
  let strategies: readonly ReceiptCodeStrategy[]
  let providers: readonly ReceiptVerificationProvider[]
  let facade: ReceiptVerificationFacadeService

  beforeEach(async () => {
    // `ProxyModule` and `ScraperWorkerModule` are @Global and come from
    // `AppModule` in the running app; a testing module has to be handed them
    // explicitly. The worker client is what monobank's signature check now goes
    // out through.
    const moduleRef = await Test.createTestingModule({
      imports: [ProxyModule, ScraperWorkerModule, ReceiptVerificationModule]
    }).compile()

    strategies = moduleRef.get(RECEIPT_CODE_STRATEGIES)
    providers = moduleRef.get(RECEIPT_VERIFICATION_PROVIDERS)
    facade = moduleRef.get(ReceiptVerificationFacadeService)
  })

  it('boots', () => {
    expect(facade).toBeInstanceOf(ReceiptVerificationFacadeService)
  })

  it.each([BankProvider.MONO, BankProvider.PRIVAT])('can read %s receipt codes', (bank) => {
    expect(strategies.map((strategy) => strategy.bank)).toContain(bank)
  })

  /**
   * Both, and they are not interchangeable. Monobank's receipts are proven by
   * monobank's own certification service, which checks the signature on the
   * uploaded file; PrivatBank's are proven by PrivatBank, which confirms a code
   * and serves its own copy of the document. One vouches for bytes and the
   * other for an identifier, so neither could answer for the other's bank.
   */
  it.each(['ca.monobank.ua', 'privatbank.ua'])('has %s to verify them at', (name) => {
    expect(providers.map((provider) => provider.name)).toContain(name)
  })

  /**
   * A strategy with no provider willing to answer for its bank is a bank whose
   * receipts are read and then never checked. Every one of them would come back
   * `UNAVAILABLE`, which sends that bank's top-ups to an operator one by one,
   * looking like an outage rather than a wiring mistake.
   *
   * Asserted through `supports` being *reachable* rather than true: both
   * providers refuse while the extractor is unconfigured, which is the state of
   * a test environment, so what is checked here is that some provider claims
   * the bank at all.
   */
  it('pairs every bank it can read with a provider that claims it', () => {
    const claimed = new Set([BankProvider.MONO, BankProvider.PRIVAT])

    expect(strategies.every((strategy) => claimed.has(strategy.bank))).toBe(true)
    expect(strategies).toHaveLength(claimed.size)
    expect(providers).toHaveLength(claimed.size)
  })
})
