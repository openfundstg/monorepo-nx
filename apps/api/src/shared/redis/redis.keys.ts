export const RedisKeys = {
  Terminal: {
    lock: (terminalId: number) => `terminal:state:lock:${terminalId}`,
    throttle: (terminalId: number) => `terminal:state:throttle:${terminalId}`,
    baseline: (terminalId: number) => `terminal:state:baseline:${terminalId}`,
    current: (terminalId: number) => `terminal:state:current:${terminalId}`,
    loopActive: (terminalId: number) => `terminal:loop:active:${terminalId}`,
    /** Signature of the last balance broadcast; its TTL is the heartbeat interval. */
    lastBroadcast: (terminalId: number) => `terminal:broadcast:${terminalId}`,
    /**
     * When a balance below the baseline was **first** seen on this terminal.
     *
     * Only banks that need a drop to prove itself over time write it — see
     * `BANK_DROP_CONFIRM_MS`. Deleted the moment a reading comes back at or
     * above the baseline, so it always describes the drop in progress and never
     * an older one.
     */
    dropSeenAt: (terminalId: number) => `terminal:state:drop-seen:${terminalId}`
  },
  FiatDeposit: {
    /**
     * Set while a stuck top-up has recently been announced to operators.
     *
     * A throttle, not state: its TTL *is* the interval between messages, so
     * there is nothing to clean up and nothing to get out of step with the
     * record. Keyed by deposit, because two stuck top-ups are two problems.
     */
    stuckAnnounced: (depositId: string) => `tma:fiat-deposit:announced:${depositId}`
  },
  Sale: {
    /**
     * Serialises one user's creates, so the parallel-order check cannot be
     * beaten by two requests arriving in the same instant.
     *
     * Keyed by `telegramId` rather than by order, because the thing being
     * protected is the count across a user's orders — there is no order id yet
     * at the point this is taken.
     */
    createLock: (telegramId: number) => `tma:sale:create:lock:${telegramId}`
  },
  Support: {
    /**
     * One key per Telegram `update_id`, and the only thing standing between a
     * retried delivery and a user's question arriving twice in the group.
     *
     * Taken with `NX` *before* the update is processed and extended on success,
     * so a delivery that is still in flight and one that already succeeded are
     * both refused; a failed one deletes the key so Telegram's retry is allowed
     * to do its job.
     */
    update: (updateId: number) => `support:update:${updateId}`,
    /**
     * Serialises topic creation for one user.
     *
     * Two messages sent in the same instant by a user who has no topic yet
     * would otherwise both see "no topic" and create one each — leaving two
     * threads for one person and a mapping row that names only the second.
     */
    topicLock: (telegramId: number) => `support:topic:create:lock:${telegramId}`,
    /**
     * The items of one album, gathered while it is still arriving.
     *
     * Scoped by chat as well as by group id: the same `media_group_id` is only
     * unique within the chat that produced it, and the relay buffers albums
     * from both sides.
     */
    albumItems: (chatId: number, mediaGroupId: string) => `support:album:${chatId}:${mediaGroupId}`,
    /**
     * A counter incremented by every arriving item of that album.
     *
     * This is how the last item is identified without Telegram ever saying
     * which one it is: each arrival takes a number, waits, and then compares
     * its number with the counter. Only the item nobody arrived after still
     * matches, so exactly one of them sends the album — a timestamp comparison
     * would let two items that arrived in the same millisecond both send it.
     */
    albumSequence: (chatId: number, mediaGroupId: string) =>
      `support:album:${chatId}:${mediaGroupId}:seq`
  },
  Admin: {
    /**
     * One live admin session. The value is the principal; the key's TTL *is*
     * the session lifetime, so expiry needs no sweeper and revoking a session
     * is a `DEL`.
     *
     * Server-side rather than a signed cookie carrying its own claims: a signed
     * cookie cannot be revoked before it expires, and "end this session now" is
     * the one thing an operator who has lost a laptop actually needs.
     */
    session: (sessionId: string) => `admin:session:${sessionId}`,
    /**
     * Failed logins from one address, within the lockout window.
     *
     * Keyed by IP and not by username, because there is only one username —
     * counting against it would let anybody lock the real operator out by
     * failing a few logins on purpose.
     */
    loginAttempts: (ip: string) => `admin:login:attempts:${ip}`
  },
  Privat: {
    /** Cached PrivatBank handshake. Key kept verbatim so live sessions survive deploys. */
    session: (terminalId: number) => `privat_session:${terminalId}`
  }
} as const

/**
 * Every Redis key that belongs to one terminal, across all namespaces.
 *
 * Deactivating a terminal has to clear all of them, and the two places that do
 * it sit in modules that cannot import each other — `TerminalsSyncService` in
 * `terminal`, `TerminalErrorHandlerService` in `bank-scraper`, which already
 * depends on the former. Listing the keys here rather than in a shared service
 * keeps one definition without inventing a dependency edge.
 *
 * Anything added to `RedisKeys.Terminal` or keyed by `terminalId` elsewhere
 * belongs in this list too, or it will outlive the terminal it describes.
 *
 * Note the ordering constraint at the call site: `loopActive` is what the
 * watchdog reads to decide whether a polling loop needs reviving, so the
 * terminal must be marked disabled in Mongo *before* these are cleared —
 * otherwise the next watchdog pass sees a live terminal with no heartbeat and
 * starts it up again.
 */
export const terminalRedisKeys = (terminalId: number): string[] => [
  RedisKeys.Terminal.lock(terminalId),
  RedisKeys.Terminal.throttle(terminalId),
  RedisKeys.Terminal.baseline(terminalId),
  RedisKeys.Terminal.current(terminalId),
  RedisKeys.Terminal.loopActive(terminalId),
  RedisKeys.Terminal.lastBroadcast(terminalId),
  RedisKeys.Terminal.dropSeenAt(terminalId),
  RedisKeys.Privat.session(terminalId)
]
