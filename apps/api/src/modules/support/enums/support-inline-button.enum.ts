/**
 * Keys that appear *inside* a message rather than under the input field.
 *
 * Deliberately a separate enum from {@link SupportButton}, whose labels are
 * indexed by `buttonOf` so that a plain-text message carrying one is treated as
 * a menu press. An inline key is answered by its `callback_data`, so putting
 * its label in that map would create nothing but a way to trigger it by typing
 * the words.
 */
export enum SupportInlineButton {
  /** Cancels the presser's standing request for a hryvnia amount. */
  FIAT_WATCH_OFF = 'FIAT_WATCH_OFF',
  /** Opens the Mini App on the top-up amounts. A `url` key, not a callback. */
  OPEN_MINI_APP = 'OPEN_MINI_APP',
  /**
   * The seller of a card sale says one order's money reached their card.
   *
   * **This key settles money.** A card sale has no scraper, so the tap is the
   * only record that the hryvnia arrived — which is also why it is safe to
   * offer in a chat: confirming money that never came costs the presser their
   * own stake, and nobody else can press it for them.
   */
  CARD_SALE_CONFIRM = 'CARD_SALE_CONFIRM',
  /** …and says it did not, which stops the sale and asks for a statement. */
  CARD_SALE_DENY = 'CARD_SALE_DENY',
  /** Opens the Mini App so a statement can be uploaded. A `url` key. */
  OPEN_SALE = 'OPEN_SALE'
}
