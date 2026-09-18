import { inject } from '@angular/core';
import type { AdminCardOrderListItem } from '@transacto/contracts';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { CardOrdersApiService } from '../services/card-orders.api.service';

export const CARD_ORDERS_FEATURE = 'cardOrders';

export const cardOrdersCollection = createCollection<AdminCardOrderListItem>(CARD_ORDERS_FEATURE, {
  defaultSort: 'createdAt',
  // Transacto's order number: unique across the product, and the one identifier
  // an operator arrives holding.
  idOf: (row) => String(row.orderId),
});

const collectionEffects = createCollectionEffects(cardOrdersCollection, () => {
  const api = inject(CardOrdersApiService);

  return (query) => api.list(query);
});

/**
 * No live effect and no action effect.
 *
 * Nothing here writes: an appeal is closed in Transacto's own panel, and a
 * second settlement path for the same money is exactly what this panel's rules
 * forbid. A dispute also moves on a human timescale — a seller uploads a
 * statement minutes or days later — so a socket push would buy a refresh button
 * nobody needed.
 */
export const cardOrdersEffects = { ...collectionEffects };
