import { TerminalSource } from '@transacto/contracts'
import { classifyTerminalSource } from 'src/shared/utils/terminal-source.util'

describe('classifyTerminalSource', () => {
  it('recognises a Mini App terminal by its generated name', () => {
    expect(classifyTerminalSource('TMA-Z38SL69F')).toBe(TerminalSource.TMA)
  })

  it('still recognises terminals named before the public-id format', () => {
    // Only the prefix is load-bearing, so terminals created under the old
    // `TMA-<telegramId>-<timestamp>` scheme keep classifying correctly.
    expect(classifyTerminalSource('TMA-885140-1739283746')).toBe(TerminalSource.TMA)
  })

  it('treats a trader-named terminal as Transacto', () => {
    expect(classifyTerminalSource('Моно Тест')).toBe(TerminalSource.TRANSACTO)
  })

  it('falls back to Transacto for a missing or unknown name', () => {
    expect(classifyTerminalSource(undefined)).toBe(TerminalSource.TRANSACTO)
    expect(classifyTerminalSource(null)).toBe(TerminalSource.TRANSACTO)
    expect(classifyTerminalSource('Unknown')).toBe(TerminalSource.TRANSACTO)
  })

  it('only matches the prefix, not the substring', () => {
    // A trader's terminal that merely mentions TMA is not a Mini App terminal
    expect(classifyTerminalSource('Моя TMA-банка')).toBe(TerminalSource.TRANSACTO)
  })

  it('is case-sensitive, matching how the Mini App writes the name', () => {
    expect(classifyTerminalSource('tma-885140-1739')).toBe(TerminalSource.TRANSACTO)
  })
})
