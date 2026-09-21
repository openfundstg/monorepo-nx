import {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminDepositKind,
  AdminDocumentKind,
  AlertStatus,
  AlertType,
  ERROR,
  OrderStatus,
  SaleBlockReason,
  SaleCardOrderState,
  SaleEventType,
  SaleEvidence,
  SaleMethod,
  SaleStatementRejection,
  SaleStatementStatus,
  SupportTopicStatus,
  FiatDepositWatchMode,
  TerminalHistoryAlertType,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaFiatReceiptRejection,
  TmaFiatReceiptStatus,
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

  /**
   * `'SALE_CARD_ORDER.' + state`, built by concatenation in the sales book's
   * column definition. It is the column an operator scans to find the rows that
   * need a person, so a member with no copy renders its own key in exactly the
   * cell that has to be legible.
   */
  it('covers every card-sale order state', () => {
    expectEveryMember('SALE_CARD_ORDER', Object.values(SaleCardOrderState));
  });

  /**
   * `'SALE_METHOD.' + method`, and the same for the deposits book's rail and
   * the archive's kind.
   *
   * Three discriminator columns, all built by concatenation, and each one is
   * the cell that says which of two things an operator is looking at — a jar
   * sale or a card sale, USDT or hryvnia, a statement or a receipt. A member
   * with no copy renders its own key in exactly the cell that has to be
   * legible.
   */
  it('covers every sale method, deposit rail and document kind', () => {
    expectEveryMember('SALE_METHOD', Object.values(SaleMethod));
    expectEveryMember('DEPOSIT_KIND', Object.values(AdminDepositKind));
    expectEveryMember('DOCUMENT_KIND', Object.values(AdminDocumentKind));
  });

  /**
   * The two verdicts behind one status column, and the two ways of failing.
   *
   * The prefix itself is chosen per row — see `documentStatusPrefix` — so
   * neither family is reachable by grep from the column that renders it.
   */
  it('covers every document verdict and refusal', () => {
    expectEveryMember('STATEMENT_STATUS', Object.values(SaleStatementStatus));
    expectEveryMember('RECEIPT_STATUS', Object.values(TmaFiatReceiptStatus));
    expectEveryMember('STATEMENT_REJECTION', Object.values(SaleStatementRejection));
    expectEveryMember('RECEIPT_REJECTION', Object.values(TmaFiatReceiptRejection));
  });

  /**
   * `'SALE_EVENT.' + type` and `'SALE_EVIDENCE.' + evidence`.
   *
   * The sale's timeline is the one screen where an unrendered key is worse than
   * useless rather than merely ugly: the column says *whose word this stands
   * on*, and a row reading `SALE_EVIDENCE.STATEMENT` next to somebody's money
   * is a row an operator cannot act on.
   */
  it('covers every timeline event and every kind of evidence', () => {
    expectEveryMember('SALE_EVENT', Object.values(SaleEventType));
    expectEveryMember('SALE_EVIDENCE', Object.values(SaleEvidence));
  });

  /** `'SALE_BLOCK_REASON.' + reason` — the chip on a blocked sale's own page. */
  it('covers every reason a sale is blocked', () => {
    expectEveryMember('SALE_BLOCK_REASON', Object.values(SaleBlockReason));
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
