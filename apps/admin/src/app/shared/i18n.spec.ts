import {
  AdminAuditAction,
  AdminAuditTargetType,
  AlertStatus,
  AlertType,
  ERROR,
  OrderStatus,
  SupportTopicStatus,
  FiatDepositWatchMode,
  TerminalHistoryAlertType,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaSaleStatus,
  TrustLevel,
} from '@transacto/contracts';
import { describe, expect, it } from 'vitest';
import uk from '../../assets/i18n/uk.json';

/**
 * The drift guard.
 *
 * Every one of these keys is built by *concatenation* — `'AUDIT.' + action`,
 * `'SALE_STATUS.' + status`, `'errors.' + code` — so its name appears
 * nowhere in the source. A grep before deleting a translation will not find it,
 * and a member added to a contract enum produces a cell that renders its own
 * key. Neither fails a build; both fail here.
 *
 * The dictionary is the shipped file, imported rather than reconstructed — a
 * spec that built its own copy would pass while the app rendered keys.
 */
const dictionary = uk as unknown as Record<string, Record<string, string>>;

const expectEveryMember = (section: string, members: readonly string[]): void => {
  const group = dictionary[section];
  expect(group, `dictionary is missing the "${section}" section`).toBeDefined();

  const missing = members.filter((member) => !group[member]);
  expect(missing, `"${section}" is missing keys for: ${missing.join(', ')}`).toEqual([]);
};

describe('translation keys built by concatenation', () => {
  it('covers every sale status', () => {
    expectEveryMember('SALE_STATUS', Object.values(TmaSaleStatus));
  });

  it('covers every deposit status', () => {
    expectEveryMember('DEPOSIT_STATUS', Object.values(TmaDepositStatus));
  });

  it('covers every fiat top-up status', () => {
    expectEveryMember('FIAT_DEPOSIT_STATUS', Object.values(TmaFiatDepositStatus));
  });

  /**
   * `'FIAT_DEPOSIT_WATCH_MODE.' + mode`, built by concatenation in the column
   * definition — so nothing else notices a missing member and the cell simply
   * renders its own key.
   */
  it('covers every amount-request mode', () => {
    expectEveryMember('FIAT_DEPOSIT_WATCH_MODE', Object.values(FiatDepositWatchMode));
  });

  it('covers every Transacto order status', () => {
    expectEveryMember('ORDER_STATUS', Object.values(OrderStatus));
  });

  it('covers every alert type and status', () => {
    expectEveryMember('ALERTS', Object.values(AlertType));
    expectEveryMember('ALERT_STATUS', Object.values(AlertStatus));
  });

  it('covers every trust level', () => {
    expectEveryMember('TRUST_LEVEL', Object.values(TrustLevel));
  });

  it('covers every support topic status', () => {
    expectEveryMember('SUPPORT_TOPIC_STATUS', Object.values(SupportTopicStatus));
  });

  it('covers every audit action and target', () => {
    // The audit trail is the one screen where an unrendered key is actively
    // misleading: a row that says `AUDIT.USER_BALANCE_ADJUSTED` looks like a
    // system fault rather than a record of somebody moving money.
    expectEveryMember('AUDIT', Object.values(AdminAuditAction));
    expectEveryMember('AUDIT_TARGET', Object.values(AdminAuditTargetType));
  });
});

describe('the shared history table', () => {
  /**
   * `@transacto/history-table` renders keys, and the library ships no
   * dictionary — each consuming app supplies them. So the panel can render a
   * table full of raw keys while the extension renders it perfectly, and
   * nothing but this notices.
   */
  it('has every column heading and state', () => {
    const table = dictionary['HISTORY']?.['TABLE'] as unknown as Record<string, string>;

    expect(table, 'HISTORY.TABLE is missing').toBeDefined();
    for (const key of [
      'TIME',
      'BALANCE',
      'EXPECTED_BALANCE',
      'UNRECOGNIZED',
      'EVENTS',
      'NO_HISTORY',
    ])
      expect(table[key], `HISTORY.TABLE.${key} is missing`).toBeTruthy();
  });

  /** `HISTORY.ORDER.' + key`, chosen by status and execution reason. */
  it('has a label for every order badge the table can pick', () => {
    const order = dictionary['HISTORY']?.['ORDER'] as unknown as Record<string, string>;

    expect(order, 'HISTORY.ORDER is missing').toBeDefined();
    for (const key of ['CANCELLED', 'PENDING', 'FULL_MATCH', 'FUZZY_MATCH', 'MANUAL', 'DEFAULT'])
      expect(order[key], `HISTORY.ORDER.${key} is missing`).toBeTruthy();
  });

  /** `HISTORY.ALERT.' + type` — one per member of the contract enum. */
  it('has a label for every history alert type', () => {
    const alerts = dictionary['HISTORY']?.['ALERT'] as unknown as Record<string, string>;

    expect(alerts, 'HISTORY.ALERT is missing').toBeDefined();

    const missing = Object.values(TerminalHistoryAlertType).filter((type) => !alerts[type]);
    expect(missing, `HISTORY.ALERT is missing: ${missing.join(', ')}`).toEqual([]);
  });

  /** `ALERTS.' + type + '_DESC'` — the tooltip on each alert badge. */
  it('has a tooltip for every history alert type', () => {
    const missing = Object.values(TerminalHistoryAlertType).filter(
      (type) => !dictionary['ALERTS']?.[`${type}_DESC`],
    );

    expect(missing, `ALERTS is missing tooltips for: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('error copy', () => {
  it('translates every admin error the panel can surface', () => {
    // `message` on an ERROR entry is developer-facing English and is never
    // shown to an operator — so a code with no copy here is a code that renders
    // as `errors.2304`.
    const adminCodes = Object.values(ERROR.ADMIN).map((entry) => String(entry.code));

    expectEveryMember('errors', adminCodes);
  });
});

describe('dictionary hygiene', () => {
  it('has no blank values', () => {
    const blanks = Object.entries(dictionary).flatMap(([section, group]) =>
      typeof group === 'object'
        ? Object.entries(group)
            .filter(([, value]) => typeof value === 'string' && value.trim() === '')
            .map(([key]) => `${section}.${key}`)
        : [],
    );

    expect(blanks).toEqual([]);
  });
});
