import en from '../../assets/i18n/en.json';
import ru from '../../assets/i18n/ru.json';
import uk from '../../assets/i18n/uk.json';

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

/**
 * Guards the translation files.
 *
 * These exist because both failure modes have already happened here: a key
 * present in uk and ru but not en rendered the raw key in English, and a script
 * that assigned `json.HISTORY = …` instead of merging silently deleted ten
 * keys, leaving the whole history page showing `HISTORY.TABLE.TIME` and friends.
 * Neither breaks the build, and neither is visible until someone opens that
 * screen in that language.
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

  it('has no empty translations', () => {
    for (const [lang, dictionary] of Object.entries(DICTIONARIES)) {
      const blank = flatten(dictionary).filter((key) => {
        const value = key.split('.').reduce<unknown>((node, part) => (node as Dictionary)?.[part], dictionary);
        return typeof value !== 'string' || value.trim() === '';
      });

      expect({ lang, blank }).toEqual({ lang, blank: [] });
    }
  });

  it('keeps the keys the history page renders', () => {
    // The regression: these were wiped by a merge-less overwrite, and the page
    // showed its own key names to the user.
    const required = [
      'HISTORY.TITLE',
      'HISTORY.BACK_TO_DASHBOARD',
      'HISTORY.TABLE.TIME',
      'HISTORY.TABLE.BALANCE',
      'HISTORY.TABLE.EXPECTED_BALANCE',
      'HISTORY.TABLE.UNRECOGNIZED',
      'HISTORY.TABLE.EVENTS',
      'HISTORY.TABLE.NO_HISTORY',
    ];

    for (const lang of Object.keys(DICTIONARIES)) {
      const langKeys = keysOf(lang);
      expect({ lang, missing: required.filter((k) => !langKeys.has(k)) }).toEqual({
        lang,
        missing: [],
      });
    }
  });

  it('interpolation placeholders match across languages', () => {
    // '{{orderId}}' missing from one language silently drops the number.
    const placeholders = (text: unknown) =>
      [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

    const read = (dictionary: Dictionary, key: string) =>
      key.split('.').reduce<unknown>((node, part) => (node as Dictionary)?.[part], dictionary);

    for (const key of flatten(uk)) {
      const expected = placeholders(read(uk, key));
      if (!expected.length) continue;

      for (const lang of ['en', 'ru']) {
        expect({ key, lang, placeholders: placeholders(read(DICTIONARIES[lang], key)) }).toEqual({
          key,
          lang,
          placeholders: expected,
        });
      }
    }
  });
});
