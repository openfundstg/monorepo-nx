import type { BankProvider } from '@transacto/contracts';

/** One deposit parked in the safe box. */
export interface SafeBoxEntry {
  readonly _id: string;
  readonly terminalName?: string;
  readonly bankProvider?: BankProvider;
  readonly amount: number;
  readonly status: string;
  readonly comment?: string | null;
  readonly alertCreatedAt?: string;
}

/** Pagination envelope returned alongside the rows. */
export interface SafeBoxMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface SafeBoxPage {
  readonly data: SafeBoxEntry[];
  readonly meta: SafeBoxMeta;
}

/** Filters accepted by `GET /extension/box/list`. */
export interface SafeBoxQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly status?: string;
  readonly term?: string;
}
