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
  OPEN_MINI_APP = 'OPEN_MINI_APP'
}
