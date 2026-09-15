/**
 * What is written to storage. Explicit strings, as `GuidePreferenceService`
 * writes, so a stray value — `'true'`, `''` — is never truthy by accident and
 * reads as "never marked".
 */
export const TourStoredState = {
  PENDING: 'pending',
  DONE: 'done'
} as const
export type TourStoredState = (typeof TourStoredState)[keyof typeof TourStoredState]
