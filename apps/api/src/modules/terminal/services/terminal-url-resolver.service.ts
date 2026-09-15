import { Injectable } from '@nestjs/common'
import { BankProvider } from 'src/shared/constants/bank.constants'
import { extractSendId } from 'src/shared/utils'

export interface ITerminalUrlStrategy {
  resolveUrl(cred3: string | null): string | null
}

class MonoUrlStrategy implements ITerminalUrlStrategy {
  resolveUrl(cred3: string | null): string | null {
    if (!cred3) return null
    const sendId = extractSendId(cred3)
    return sendId ? `https://send.monobank.ua/jar/${sendId}` : cred3
  }
}

class DefaultUrlStrategy implements ITerminalUrlStrategy {
  resolveUrl(cred3: string | null): string | null {
    return cred3
  }
}

/**
 * Turns a terminal's stored credential into a link a human can open.
 *
 * Lives in the terminal module rather than the extension's because three
 * separate answers need it now — the dashboard, the terminal search and the
 * live `terminal.enabled` push — and a card that reached the client by socket
 * has to carry the same link as the same card fetched over HTTP.
 */
@Injectable()
export class TerminalUrlResolverService {
  private readonly strategies = new Map<BankProvider, ITerminalUrlStrategy>()
  private readonly defaultStrategy = new DefaultUrlStrategy()

  constructor() {
    this.strategies.set(BankProvider.MONO, new MonoUrlStrategy())
  }

  resolve(provider: BankProvider | null, cred3: string | null): string | null {
    if (!provider) {
      return this.defaultStrategy.resolveUrl(cred3)
    }
    const strategy = this.strategies.get(provider) || this.defaultStrategy
    return strategy.resolveUrl(cred3)
  }
}
