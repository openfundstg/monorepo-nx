import en from '../../assets/i18n/en.json';
import ru from '../../assets/i18n/ru.json';
import uk from '../../assets/i18n/uk.json';
// Reached into from `shared/` only because this is a spec — nothing shipped
// crosses that way. The alternative was hand-copying every guide key into the
// pinned list below, where it would drift the first time a bank gains a step.
import { BANK_GUIDE } from '../sale/constants/bank-guide.const';
// Reached into for the same reason: the tour's per-step keys exist only in
// `TOUR_STEPS`, and a copied list would not know about a step added there.
import { TOUR_STEPS } from '../onboarding/constants/tour.const';

type Dictionary = Record<string, unknown>;

const DICTIONARIES: Record<string, Dictionary> = { en, ru, uk };

/** Flattens `{ a: { b: 'x' } }` to `['a.b']`. */
const flatten = (node: Dictionary, prefix = ''): string[] =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object'
      ? flatten(value as Dictionary, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

const keysOf = (lang: string) => new Set(flatten(DICTIONARIES[lang]));

const read = (dictionary: Dictionary, key: string) =>
  key.split('.').reduce<unknown>((node, part) => (node as Dictionary)?.[part], dictionary);

/**
 * Guards the translation files.
 *
 * The mini app has already shipped both failure modes: uk had 83 keys, en 81
 * and ru 77, so `dashboard.frozen`, three `status.*` keys and two
 * `sale.amount_usdt_*` keys rendered as raw dotted strings for Russian users
 * only. Nothing about that fails the build, and nobody sees it until the app is
 * opened on that screen in that language.
 *
 * The risk got worse once keys started being built by concatenation —
 * `'status.' + status.toLowerCase()`, `'SALE_EVENT.' + event.type`,
 * `'trust.' + level` — because a grep for the literal key finds nothing. The
 * pinned list below is the only place those names appear in the source.
 */
describe('i18n dictionaries', () => {
  it('all define exactly the same keys', () => {
    const [reference, ...others] = Object.keys(DICTIONARIES);
    const referenceKeys = keysOf(reference);

    for (const lang of others) {
      const langKeys = keysOf(lang);

      expect({
        lang,
        missing: [...referenceKeys].filter((k) => !langKeys.has(k)).sort(),
        extra: [...langKeys].filter((k) => !referenceKeys.has(k)).sort(),
      }).toEqual({ lang, missing: [], extra: [] });
    }
  });

  /**
   * Users of the Mini App must never see the operator-side name.
   *
   * Nothing here names it today — the brand reaches users through the bot and
   * the app shell, not the dictionaries — and this is what keeps it that way.
   * Copy is added a key at a time, in three files, by whoever is writing the
   * feature, and "just don't mention it" is not a thing a build can check
   * unless something checks it.
   */
  it('name no brand but the current one', () => {
    for (const [lang, dictionary] of Object.entries(DICTIONARIES)) {
      const offenders = flatten(dictionary).filter((key) =>
        /transacto/i.test(String(read(dictionary, key))),
      );

      expect({ lang, offenders }).toEqual({ lang, offenders: [] });
    }
  });

  /**
   * The dashboard's profit line is bound with `[innerHTML]` so a language can
   * put its own bold where its own word order wants it. That makes the
   * dictionaries the one place in this app whose contents reach the DOM as
   * markup, and this is the fence around it.
   *
   * Angular sanitises the binding, so a stray tag is a rendering bug rather
   * than a script — but "sanitised" is not "intended", and an unclosed tag or a
   * stray `<div>` inside a `<span>` breaks the sentence quietly and only in the
   * language that has it. `<strong>` is the whole vocabulary; widening it is a
   * decision, and a decision should have to edit this list to happen.
   */
  it('uses no markup but the one tag the profit line needs', () => {
    const ALLOWED = /^<\/?strong>$/;

    for (const [lang, dictionary] of Object.entries(DICTIONARIES)) {
      const offenders = flatten(dictionary).flatMap((key) => {
        const tags = String(read(dictionary, key)).match(/<[^>]*>/g) ?? [];
        return tags.filter((tag) => !ALLOWED.test(tag)).map((tag) => `${key}: ${tag}`);
      });

      expect({ lang, offenders }).toEqual({ lang, offenders: [] });
    }
  });

  /** Every `<strong>` is closed, and nothing nests inside another. */
  it('balances the markup it does allow', () => {
    for (const [lang, dictionary] of Object.entries(DICTIONARIES)) {
      const unbalanced = flatten(dictionary).filter((key) => {
        let depth = 0;

        for (const tag of String(read(dictionary, key)).match(/<[^>]*>/g) ?? []) {
          depth += tag === '<strong>' ? 1 : -1;
          if (depth < 0 || depth > 1) return true;
        }

        return depth !== 0;
      });

      expect({ lang, unbalanced }).toEqual({ lang, unbalanced: [] });
    }
  });

  it('has no empty translations', () => {
    for (const [lang, dictionary] of Object.entries(DICTIONARIES)) {
      const blank = flatten(dictionary).filter((key) => {
        const value = read(dictionary, key);
        return typeof value !== 'string' || value.trim() === '';
      });

      expect({ lang, blank }).toEqual({ lang, blank: [] });
    }
  });

  it('interpolation placeholders match across languages', () => {
    // '{{amount}}' missing from one language silently drops the number, and the
    // sentence still reads as a sentence — so nothing looks broken.
    const placeholders = (text: unknown) =>
      [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

    for (const key of flatten(uk)) {
      // The expectation is the UNION across all three languages, not whatever
      // one reference language happens to say. Anchoring on a single dictionary
      // — uk, previously — meant a placeholder dropped from *that* dictionary
      // was never compared against anything: the loop simply skipped the key as
      // having no placeholders. uk is the default language and the primary
      // market, so that was the one hole most likely to reach real users.
      const expected = [
        ...new Set(Object.values(DICTIONARIES).flatMap((dict) => placeholders(read(dict, key)))),
      ].sort();
      if (!expected.length) continue;

      for (const lang of Object.keys(DICTIONARIES)) {
        expect({ key, lang, placeholders: placeholders(read(DICTIONARIES[lang], key)) }).toEqual({
          key,
          lang,
          placeholders: expected,
        });
      }
    }
  });

  it('keeps the keys the settings, referral and sale status pages render', () => {
    // Every key here is either built by concatenation at runtime or belongs to a
    // page with no other coverage, so deleting one is invisible until the screen
    // is opened. `status.*` comes from `'status.' + status.toLowerCase()` and
    // `SALE_EVENT.*` from `'SALE_EVENT.' + event.type`.
    const required = [
      'settings.title',
      'settings.language',
      'settings.language_hint',
      'settings.saved',
      'settings.privacy',
      'settings.show_name_to_referrer',
      'settings.show_name_to_referrer_hint',
      // The tour's chrome and its Settings entry. The per-step copy is derived
      // from TOUR_STEPS in the test below.
      'tour.next',
      'tour.skip',
      'tour.done',
      'tour.progress',
      'settings.tour',
      'settings.tour_hint',
      'settings.tour_action',
      // The forced-update screen. It has no other coverage and, by design,
      // nobody sees it until a release is already out — an untranslated key
      // there would ship and sit unnoticed until the worst possible moment.
      'update.title',
      'update.text',
      'update.action',

      // `'dashboard.movement.' + kind` on the balance timeline — the two
      // movements that have no process document behind them, and therefore no
      // other string anywhere naming them.
      'dashboard.movement.REFERRAL_TRANSFER',
      'dashboard.movement.ADMIN_ADJUSTMENT',

      'nav.home',
      'nav.referral',
      'nav.settings',

      // The referral page has no spec of its own, so every string it renders is
      // pinned here — including `referral.masked_user`, which stands in for the
      // name of anyone who has not opted into being identified and would
      // otherwise render as a raw dotted key to their referrer.
      'referral.title',
      'referral.balance',
      'referral.total_earned',
      'referral.rate_hint',
      'referral.transfer_title',
      'referral.transfer_hint',
      'referral.transfer_placeholder',
      'referral.transfer_all',
      'referral.transfer',
      'referral.transferring',
      'referral.transferred',
      'referral.your_link',
      'referral.copy_link',
      'referral.copied',
      'referral.tap_to_copy',
      'referral.code_copied',
      'referral.have_a_code',
      'referral.have_a_code_hint',
      'referral.code_placeholder',
      'referral.redeem',
      'referral.redeeming',
      'referral.invited_by',
      'referral.your_referrals',
      'referral.masked_user',
      'referral.sold',
      'referral.empty',

      // The way out of a goal mismatch — rendered only while that error is on
      // screen, so nothing else would notice it missing.
      'sale.goal_use_suggested',

      'sale.public_id',
      'sale.public_id_copied',
      'sale.progress',
      'sale.received_of',
      'sale.timeline',
      'sale.timeline_empty',
      'sale.live',
      'sale.offline',

      'SALE_EVENT.TERMINAL_CREATED',
      'SALE_EVENT.ORDER_RECEIVED',
      'SALE_EVENT.PAYMENT_MATCHED',
      'SALE_EVENT.ORDER_CANCELLED',
      'SALE_EVENT.COMPLETED',
      'SALE_EVENT.FAILED',

      'status.created',
      'status.created_desc',
      'status.terminal_ready',
      'status.terminal_ready_desc',
      'status.awaiting_fiat',
      'status.awaiting_fiat_desc',
      'status.completed',
      'status.completed_desc',
      'status.failed',
      'status.failed_desc',
      'status.cancelled',
      // The dashboard renders a fiat top-up's status the same way it renders a
      // sale's: `'status.' + status.toLowerCase()`.
      'status.reserved',
      'status.partially_paid',
      'status.review',
      'status.blocked',
      'status.blocked_desc',

      // `'BLOCK_REASON.' + reason` on the status page — concatenated, so a grep
      // for these names finds nothing but this list.
      // The fiat top-up renders two families by concatenation:
      // `'fiat.status.' + status` and `'fiat.receipt_status.' + status`. Neither
      // name appears anywhere else in the source, so a grep before deleting one
      // finds nothing.
      //
      // `fiat.rejection.*` was a third until a refused receipt stopped being
      // something the user can act on: all three reasons now read as one
      // sentence, `fiat.receipt_rejected`, and the reason itself stays on the
      // record for the operator who has to sort it out.
      'fiat.status.RESERVED',
      'fiat.status.PARTIALLY_PAID',
      'fiat.status.COMPLETED',
      'fiat.status.EXPIRED',
      'fiat.status.CANCELLED',
      'fiat.status.REVIEW',
      'fiat.receipt_status.PARSING',
      'fiat.receipt_status.ACCEPTED',
      'fiat.receipt_status.REJECTED',

      'BLOCK_REASON.GOAL_MISMATCH',
      'BLOCK_REASON.ORDERS_EXPIRED',
      'BLOCK_REASON.LEDGER_MISMATCH',
      'SALE_EVENT.BLOCKED',
      'SALE_EVENT.STOPPED_BY_USER',
    ];

    for (const lang of Object.keys(DICTIONARIES)) {
      const langKeys = keysOf(lang);
      expect({ lang, missing: required.filter((k) => !langKeys.has(k)) }).toEqual({
        lang,
        missing: [],
      });
    }
  });

  /**
   * The bank setup guide, checked against the constant that renders it rather
   * than against a hand-written list.
   *
   * Every step's text lives behind a key held in `BANK_GUIDE`, so adding a step
   * to a bank silently adds a required translation. Deriving the expectation
   * from the same constant means that new step fails here until all three
   * dictionaries carry it — where a copied list would simply not know about it.
   */
  it('translates every step of every bank guide', () => {
    const guideKeys = [
      'sale.guide.title',
      'sale.guide.screenshot_pending',
      'sale.guide.link_example',
      'sale.guide.required_host',
      'sale.guide.goal_rule',
      ...Object.values(BANK_GUIDE).flatMap((guide) => [
        ...guide.steps.map((step) => step.textKey),
        guide.warningKey,
        // Optional — only banks whose link is resolved server-side carry one.
        ...(guide.fallbackKey ? [guide.fallbackKey] : []),
      ]),
    ];

    for (const lang of Object.keys(DICTIONARIES)) {
      const langKeys = keysOf(lang);
      expect({ lang, missing: guideKeys.filter((k) => !langKeys.has(k)) }).toEqual({
        lang,
        missing: [],
      });
    }
  });

  /**
   * The onboarding tour, checked against the constant that renders it. Every
   * step's title and text sit behind keys held in `TOUR_STEPS`, so a step added
   * there fails here until all three dictionaries carry its copy.
   */
  it('translates every step of the tour', () => {
    const tourKeys = TOUR_STEPS.flatMap((step) => [step.titleKey, step.textKey]);

    for (const lang of Object.keys(DICTIONARIES)) {
      const langKeys = keysOf(lang);
      expect({ lang, missing: tourKeys.filter((k) => !langKeys.has(k)) }).toEqual({
        lang,
        missing: [],
      });
    }
  });
});
