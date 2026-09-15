import type { AdminAuditLogItem } from '@transacto/contracts';
import { AdminAuditAction } from '@transacto/contracts';
import { ChipTone, ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';

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
    key: 'targetId',
    header: 'audit.target',
    type: ColumnType.MONO,
    value: (row) => row.targetId,
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
