import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DECLARED_VALUES } from 'src/shared/testing/declared-not-personal.const'

/** The workspace root, four levels up from this file. */
const WORKSPACE = resolve(__dirname, '../../../..')

/** Text this repository authors. Binaries and lockfiles are not read. */
const SOURCE = /\.(ts|js|mjs|cjs|json|html|scss|css|md|py|yml|yaml|sh)$/

/**
 * The two files that must name the values in order to guard them.
 *
 * Without this the check reports itself, which is the kind of failure that
 * teaches people to delete a check rather than to satisfy it.
 */
const SELF = new Set(['apps/api/src/shared/no-real-data.spec.ts'])

/**
 * What a personal identifier looks like, mechanically.
 *
 * Deliberately wider than "a card": a long run of digits is caught and then
 * declared, because the cost of declaring a Telegram group id once is nothing
 * beside the cost of a card slipping through for want of a tighter pattern.
 */
const PATTERNS: readonly { readonly kind: string; readonly rx: RegExp }[] = [
  { kind: 'card-shaped digits', rx: /(?<!\d)\d{13,19}(?!\d)/g },
  { kind: 'masked card', rx: /(?<![\d*])\d{4,8}\s?\*{2,}\s?\*{0,4}\s?\d{4}(?![\d*])/g },
  { kind: 'IBAN', rx: /UA\d{27}/g }
]

/**
 * Whether ten digits satisfy the Ukrainian tax number's own checksum.
 *
 * **This is the check that would have caught the one that got through.** A tax
 * id is ten digits and so is a millisecond timestamp, so a length rule flags
 * everything and therefore nothing. The checksum does not: every timestamp in
 * this repository passes straight through it, and the real number that was
 * committed does not.
 */
const isTaxNumber = (digits: string): boolean => {
  const weights = [-1, 5, 7, 9, 4, 6, 10, 5, 7]
  const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0)

  return (((sum % 11) + 11) % 11) % 10 === Number(digits[9])
}

interface Finding {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly value: string
}

/**
 * Everything the repository holds or is about to.
 *
 * **Asked of git rather than of the filesystem**, because the rule is about
 * what is committed and git is the only thing that knows. The first run of this
 * check walked the directory tree instead and reported a capture of the
 * Transacto payout book — a file full of real recipient cards that is correctly
 * gitignored and has never been committed. A check that shouts about a file
 * somebody deliberately excluded is a check that gets deleted.
 *
 * `--cached --others --exclude-standard` is tracked files *and* new ones that
 * are not ignored, so a fixture is caught while it is still being written and
 * not only once it has been committed.
 */
const repositoryFiles = (): readonly string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
    .split('\0')
    .filter((path) => path !== '' && SOURCE.test(path))

const scan = (file: string): readonly Finding[] => {
  if (SELF.has(file)) return []

  const lines = readFileSync(join(WORKSPACE, file), 'utf8').split('\n')

  return lines.flatMap((text, index) => {
    const found: Finding[] = []

    for (const { kind, rx } of PATTERNS) {
      for (const match of text.matchAll(rx)) {
        if (!DECLARED_VALUES.has(match[0])) {
          found.push({ file, line: index + 1, kind, value: match[0] })
        }
      }
    }

    for (const match of text.matchAll(/(?<!\d)\d{10}(?!\d)/g)) {
      if (isTaxNumber(match[0]) && !DECLARED_VALUES.has(match[0])) {
        found.push({ file, line: index + 1, kind: 'tax number', value: match[0] })
      }
    }

    return found
  })
}

/**
 * **No real personal or financial data is ever committed.**
 *
 * The rule is in the root `CLAUDE.md`, it is well written, and it did not work:
 * a real tax number, a real name and a masked card from a live capture were all
 * committed and pushed, and removing them took a history rewrite and a
 * force-push. A rule in prose is followed by whoever happens to have read it;
 * this is followed by everybody, because it fails the build.
 *
 * It cannot tell a real card from an invented one — nothing can — so it does
 * not try. What it enforces is that **every value of this shape has been
 * declared**, in `declared-not-personal.const.ts`, with a sentence saying why it
 * is safe. Pasting is no longer enough; somebody has to write that sentence.
 *
 * Names are the one kind it cannot reach: `Петренко Роман Іванович` and a real
 * person's name are the same shape. They are CHECK 8 of the strict reviewer
 * instead, which is a weaker guarantee honestly labelled rather than a stronger
 * one pretended at.
 */
describe('no real personal or financial data in the repository', () => {
  it('has every card, masked card, IBAN and tax number declared as invented', () => {
    const findings = repositoryFiles().flatMap(scan)

    expect({
      count: findings.length,
      findings: findings.slice(0, 20),
      remedy:
        findings.length === 0
          ? ''
          : 'Each value above is either real — in which case replace it with an invented one ' +
            'that still satisfies whatever the code checks — or it is not personal data at ' +
            'all, in which case declare it in apps/api/src/shared/testing/' +
            'declared-not-personal.const.ts with the reason. See the root CLAUDE.md, ' +
            '"Real data never lives in the repository".'
    }).toEqual({ count: 0, findings: [], remedy: '' })
  })
})
