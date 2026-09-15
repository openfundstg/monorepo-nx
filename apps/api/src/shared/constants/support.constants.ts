/**
 * Vocabulary shared between the support domain module and its repository.
 *
 * Only what genuinely crosses that boundary lives here — the schema stores a
 * {@link SupportTopicStatus}, and `SupportTopicService` decides which one to
 * write. Everything the domain module alone knows about (command words, lock
 * TTLs, topic-name limits) stays in `src/modules/support/constants`.
 *
 * `SupportTopicStatus` and `SupportLocale` moved to `@transacto/contracts` when
 * the admin panel started listing support threads and the people behind them —
 * both now cross the wire. They are re-exported here so the eleven existing
 * importers keep working; this is a bridge, not a licence to redeclare.
 */
export { SupportTopicStatus, SupportLocale } from '@transacto/contracts'

/**
 * What a topic's title says about the conversation.
 *
 * Stored rather than derived, and stored as *what was last written to
 * Telegram* rather than as the truth: renaming a topic costs an API call and
 * leaves a service line in the thread, so the only safe way to rename exactly
 * on a change is to remember what the title currently says.
 *
 * Backend-only, unlike the two above. It describes our conversation with
 * Telegram rather than the support thread itself, and no client has a use for
 * it.
 *
 * **Deliberately two states, not three.** An earlier version also marked
 * "answered", which meant a rename on every turn of every conversation — and
 * Telegram writes a service line into the thread for each one, so a normal
 * exchange came out half paperwork. Open versus closed changes about twice per
 * conversation, which is a price the topic list is worth.
 */
export enum SupportTopicTitleState {
  /** A live conversation. */
  OPEN = 'OPEN',
  /** Closed with `/close`. Reopens the moment its owner writes again. */
  CLOSED = 'CLOSED'
}
