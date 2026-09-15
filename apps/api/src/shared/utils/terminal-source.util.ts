import { TerminalSource, TMA_TERMINAL_NAME_PREFIX } from '@transacto/contracts'

/**
 * Works out who created a terminal from the name Transacto reports.
 *
 * Both kinds are created through the Transacto API, so upstream cannot tell them
 * apart — the Mini App names its terminals `TMA-<publicId>`, and that prefix is
 * the only signal that survives the round trip. Only the prefix is tested, so
 * the suffix format can change without touching this.
 *
 * Re-derived on every sync rather than stored once, so terminals created before
 * the field existed get classified too.
 */
export const classifyTerminalSource = (terminalName: string | null | undefined): TerminalSource =>
  terminalName?.startsWith(TMA_TERMINAL_NAME_PREFIX) ? TerminalSource.TMA : TerminalSource.TRANSACTO
