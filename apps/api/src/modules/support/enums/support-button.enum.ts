/**
 * The keys of the persistent keyboard under the input field.
 *
 * A reply-keyboard press arrives as an ordinary text message carrying the
 * button's label and nothing else — no callback, no marker. So these members
 * are matched back from the label, across *every* locale: a user who switches
 * language still has the old keyboard on screen until Telegram redraws it, and
 * a bot that only recognised the current language's labels would forward their
 * next tap to an operator as a question reading "Balance".
 */
export enum SupportButton {
  GUIDE = 'GUIDE',
  SUPPORT = 'SUPPORT',
  BALANCE = 'BALANCE',
  LANGUAGE = 'LANGUAGE'
}
