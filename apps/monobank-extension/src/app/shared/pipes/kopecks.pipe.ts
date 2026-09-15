/**
 * `KopecksPipe` moved to `@transacto/history-table` when the terminal history
 * table became shared with the admin panel — the table renders money in every
 * one of its columns, so the pipe had to travel with it.
 *
 * Re-exported here so the three other places in this app that use it keep
 * working. A bridge, not a licence to redeclare.
 */
export { KopecksPipe } from '@transacto/history-table'
