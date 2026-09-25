import type { ReferralSummary } from '@transacto/contracts'

/** The caller's own code, the link that carries it, and the rate it earns at. */
export type ReferralSharingTerms = Pick<ReferralSummary, 'code' | 'link' | 'ratePercent'>
