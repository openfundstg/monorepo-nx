import type { AdminAuditLogItem } from '@transacto/contracts';
import { AdminAuditAction, AdminAuditTargetType, AdminDepositKind } from '@transacto/contracts';
import { ChipTone, ColumnType } from '../../shared/enums';
import type { ColumnDef, RowLink } from '../../shared/interfaces';
import { depositLink, saleLink, terminalLink, traderLink, userLink } from '../../shared/utils';

/**
 * The actions worth drawing attention to.
 *
 * Everything that moves money or removes somebody's access reads as
 * destructive; the rest is neutral. A failed login is amber rather than red on
 * purpose — one is a typo, and colouring every one of them as an incident is
 * how a real run of them stops being noticed.
 */
const DESTRUCTIVE: ReadonlySet<AdminAuditAction> = new Set([
  AdminAuditAction.USER_BALANCE_ADJUSTED,
  AdminAuditAction.USER_DEACTIVATED,
  AdminAuditAction.SALE_CANCELLED,
  AdminAuditAction.SALE_BLOCKED,
  AdminAuditAction.TERMINAL_DISABLED,
  AdminAuditAction.TRADER_DEACTIVATED,
]);

const auditTone = (action: AdminAuditAction): ChipTone => {
  if (DESTRUCTIVE.has(action)) return ChipTone.DANGER;
  if (action === AdminAuditAction.LOGIN_FAILED) return ChipTone.WARNING;

  return ChipTone.NEUTRAL;
};

export const AUDIT_COLUMNS: readonly ColumnDef<AdminAuditLogItem>[] = [
  {
    key: 'createdAt',
    header: 'audit.when',
    type: ColumnType.DATE,
    value: (row) => row.createdAt,
    sortable: true,
    width: '140px',
  },
  {
    key: 'actor',
    header: 'audit.actor',
    type: ColumnType.TEXT,
    value: (row) => row.actor,
    width: '140px',
  },
  {
    key: 'action',
    header: 'audit.action',
    type: ColumnType.CHIP,
    value: (row) => row.action,
    tone: (row) => auditTone(row.action),
    translatePrefix: 'AUDIT',
  },
  {
    key: 'targetType',
    header: 'audit.target_type',
    type: ColumnType.CHIP,
    value: (row) => row.targetType,
    tone: () => ChipTone.NEUTRAL,
    translatePrefix: 'AUDIT_TARGET',
  },
  {
    /**
     * What the action was about, as a link to it.
     *
     * The audit trail's whole failure mode was being read-only in the worst
     * sense: a row said an operator adjusted a balance and named a number, and
     * finding out whose took a copy, a navigation and a paste. `targetType`
     * already says which kind of thing the id names, so the link is decidable.
     */
    key: 'targetId',
    header: 'audit.target',
    type: ColumnType.ROUTER_LINK,
    value: (row) => row.targetId,
    link: (row) => targetLink(row.targetType, row.targetId),
  },
  {
    key: 'reason',
    header: 'common.reason',
    type: ColumnType.TEXT,
    value: (row) => row.reason,
  },
  {
    key: 'ip',
    header: 'audit.ip',
    type: ColumnType.MONO,
    value: (row) => row.ip,
  },
];

/**
 * Where one audit row's target lives.
 *
 * `null` for the targets that are not rows anywhere — a session is an event,
 * not a record — and for an id that is not the shape its type promises, which
 * an old row written before a convention settled can be.
 */
const targetLink = (type: AdminAuditTargetType, targetId: string): RowLink | null => {
  const asNumber = Number(targetId);
  const numeric = Number.isSafeInteger(asNumber) && asNumber > 0;

  switch (type) {
    case AdminAuditTargetType.TMA_USER:
      return numeric ? userLink(asNumber, targetId) : null;
    case AdminAuditTargetType.SALE:
      return saleLink(targetId);
    case AdminAuditTargetType.FIAT_DEPOSIT:
      return depositLink(AdminDepositKind.FIAT, targetId);
    case AdminAuditTargetType.DEPOSIT:
      return depositLink(AdminDepositKind.CRYPTO, targetId);
    case AdminAuditTargetType.TERMINAL:
      return numeric ? terminalLink(asNumber, targetId) : null;
    case AdminAuditTargetType.TRADER:
      return numeric ? traderLink(asNumber, targetId) : null;
    // An alert may already have been deleted by the very action being audited,
    // and a session is an event rather than a row. Neither has anywhere to go.
    case AdminAuditTargetType.ALERT:
    case AdminAuditTargetType.SESSION:
      return null;
  }
};
