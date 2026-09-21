import type { AdminSupportTopicListItem, AdminSupportUserListItem } from '@transacto/contracts';
import { ColumnType } from '../../shared/enums';
import type { ColumnDef } from '../../shared/interfaces';
import { supportTopicTone, userLink } from '../../shared/utils';

export const SUPPORT_TOPIC_COLUMNS: readonly ColumnDef<AdminSupportTopicListItem>[] = [
  {
    key: 'displayName',
    header: 'support.name',
    type: ColumnType.TEXT,
    value: (topic) => topic.displayName,
  },
  {
    key: 'telegramId',
    header: 'users.telegram_id',
    type: ColumnType.ROUTER_LINK,
    value: (topic) => topic.telegramId,
    link: (topic) => userLink(topic.telegramId),
  },
  {
    key: 'messageThreadId',
    header: 'support.thread',
    type: ColumnType.MONO,
    value: (topic) => topic.messageThreadId,
  },
  {
    key: 'status',
    header: 'common.status',
    type: ColumnType.CHIP,
    value: (topic) => topic.status,
    tone: (topic) => supportTopicTone(topic.status),
    translatePrefix: 'SUPPORT_TOPIC_STATUS',
  },
  {
    key: 'lastUserMessageAt',
    header: 'support.last_from_user',
    type: ColumnType.DATE,
    value: (topic) => topic.lastUserMessageAt,
    sortable: true,
  },
  {
    key: 'lastAdminMessageAt',
    header: 'support.last_from_admin',
    type: ColumnType.DATE,
    value: (topic) => topic.lastAdminMessageAt,
  },
  {
    key: 'updatedAt',
    header: 'common.updated',
    type: ColumnType.DATE,
    value: (topic) => topic.updatedAt,
    sortable: true,
  },
];

/**
 * `hasTmaAccount` earns a column because it is the question this list is opened
 * to answer: somebody writing to the bot may have no account at all, and a
 * support reply that assumes one is a reply about a balance that does not
 * exist.
 */
export const SUPPORT_USER_COLUMNS: readonly ColumnDef<AdminSupportUserListItem>[] = [
  {
    key: 'username',
    header: 'support.name',
    type: ColumnType.TEXT,
    value: (user) =>
      user.username ? `@${user.username}` : [user.firstName, user.lastName].join(' ').trim(),
  },
  {
    /**
     * A link only for somebody who has a Mini App account.
     *
     * `telegramId` is a join key here and never a foreign key — somebody can
     * write to the bot without ever opening the app — so a link that always
     * fired would send an operator to a page that does not exist for a third of
     * this list.
     */
    key: 'telegramId',
    header: 'users.telegram_id',
    type: ColumnType.ROUTER_LINK,
    value: (user) => user.telegramId,
    link: (user) => (user.hasTmaAccount ? userLink(user.telegramId) : null),
  },
  {
    key: 'languageCode',
    header: 'support.client_language',
    type: ColumnType.TEXT,
    value: (user) => user.languageCode,
  },
  {
    key: 'preferredLocale',
    header: 'support.chosen_language',
    type: ColumnType.TEXT,
    value: (user) => user.preferredLocale,
  },
  {
    key: 'hasTmaAccount',
    header: 'support.has_account',
    type: ColumnType.BOOL,
    value: (user) => user.hasTmaAccount,
  },
  {
    key: 'lastSeenAt',
    header: 'support.last_seen',
    type: ColumnType.DATE,
    value: (user) => user.lastSeenAt,
    sortable: true,
  },
  {
    key: 'createdAt',
    header: 'common.created',
    type: ColumnType.DATE,
    value: (user) => user.createdAt,
    sortable: true,
  },
];
