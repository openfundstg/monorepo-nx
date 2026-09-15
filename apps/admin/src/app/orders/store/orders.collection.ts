import { inject } from '@angular/core';
import type { AdminOrderListItem } from '@transacto/contracts';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { OrdersApiService } from '../services/orders.api.service';

export const ORDERS_FEATURE = 'orders';

export const ordersCollection = createCollection<AdminOrderListItem>(ORDERS_FEATURE, {
  defaultSort: 'createdAt',
  idOf: (row) => row.id,
});

const collectionEffects = createCollectionEffects(ordersCollection, () => {
  const api = inject(OrdersApiService);

  return (query) => api.list(query);
});

export const ordersEffects = { ...collectionEffects };
