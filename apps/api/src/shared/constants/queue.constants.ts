export const BANK_SCRAPER_QUEUE_NAME = 'bank-scraper-check'

/**
 * Flushes one gathered album to the other side of the support relay.
 *
 * A queue rather than a wait inside the webhook request, and the difference is
 * not stylistic: **Telegram delivers a chat's updates one at a time**, holding
 * the next until the current one is answered. A request that waits for the rest
 * of an album is therefore waiting for updates that its own waiting is
 * preventing — the first item times out alone, then the second, then the third,
 * and three photos arrive as three messages. Answering immediately and flushing
 * from a delayed job is the only way the items can arrive at all.
 */
export const SUPPORT_ALBUM_QUEUE = 'support-album-flush'

/** What the flush job needs to find its album; the items themselves are in Redis. */
export interface SupportAlbumJobData {
  chatId: number
  mediaGroupId: string
}

/**
 * Job data contract between OrderPollingModule (producer)
 * and BankScraperModule (consumer).
 */
export interface ScraperJobData {
  terminalId: number
  targetId: string
  targetUrl: string
  apiToken: string
  traderId: number
  cardId: number
  isManualSync?: boolean
}
