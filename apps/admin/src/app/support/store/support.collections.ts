import { inject } from '@angular/core';
import type { AdminSupportTopicListItem, AdminSupportUserListItem } from '@transacto/contracts';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { SupportApiService } from '../services/support.api.service';

/**
 * Two collections, because they are two collections.
 *
 * A support thread and a bot user are joined by `telegramId` and nothing else —
 * anyone can message the bot without ever opening the Mini App, so neither
 * table is a subset of the other. Sharing one slice between them would mean the
 * tab switch threw away the other tab's paging.
 */
export const SUPPORT_TOPICS_FEATURE = 'supportTopics';
export const SUPPORT_USERS_FEATURE = 'supportUsers';

export const supportTopicsCollection = createCollection<AdminSupportTopicListItem>(
  SUPPORT_TOPICS_FEATURE,
  { defaultSort: 'updatedAt', idOf: (topic) => topic.id },
);

export const supportUsersCollection = createCollection<AdminSupportUserListItem>(
  SUPPORT_USERS_FEATURE,
  { defaultSort: 'lastSeenAt', idOf: (user) => user.id },
);

/**
 * No live stream for either.
 *
 * The support bot's traffic reaches Telegram, not this panel — an operator
 * answering a thread does so in the supergroup, where the message and its
 * attachments already are. A push here would only tell them something they are
 * already looking at somewhere better.
 *
 * Two objects rather than one merged one: both collections produce effects
 * named `enter`, `search`, `paging` and `load`, so spreading them together
 * would leave only the second set and the topics tab would never load.
 * `provideEffects` is variadic, so the route passes both.
 */
export const supportTopicsEffects = createCollectionEffects(supportTopicsCollection, () => {
  const api = inject(SupportApiService);

  return (query) => api.listTopics(query);
});

export const supportUsersEffects = createCollectionEffects(supportUsersCollection, () => {
  const api = inject(SupportApiService);

  return (query) => api.listUsers(query);
});
