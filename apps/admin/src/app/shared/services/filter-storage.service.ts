import { Injectable } from '@angular/core';

/** What one list remembers between visits. */
export interface StoredFilters {
  readonly filters: Readonly<Record<string, string>>;
  readonly expanded: boolean;
}

const KEY_PREFIX = 'transacto.admin.filters.';

/**
 * What an operator last narrowed a list to, remembered on their own machine.
 *
 * **Per viewer, and deliberately not in the store.** A filter set is a working
 * preference rather than shared state: two operators watching the same book
 * want different slices of it, and an operator who comes back after lunch wants
 * the one they left. It survives a reload, never reaches the server, and never
 * reaches another person.
 *
 * **Every read and every write is guarded**, because `localStorage` is not
 * reliably there. A private window, cleared site data, a browser configured to
 * refuse storage — each makes the accessor throw rather than return nothing,
 * and a panel that fails to open because it could not remember a date range
 * would be a worse product than one that forgets.
 */
@Injectable({ providedIn: 'root' })
export class FilterStorageService {
  read(list: string): StoredFilters | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + list);
      if (raw === null) return null;

      const parsed: unknown = JSON.parse(raw);

      // Whatever is in storage was written by an older version of this app, by
      // hand, or by nobody. It is read as data rather than trusted as a shape.
      if (typeof parsed !== 'object' || parsed === null) return null;

      const { filters, expanded } = parsed as Partial<StoredFilters>;

      return {
        filters: this.readFilters(filters),
        expanded: expanded === true,
      };
    } catch {
      return null;
    }
  }

  write(list: string, value: StoredFilters): void {
    try {
      localStorage.setItem(KEY_PREFIX + list, JSON.stringify(value));
    } catch {
      // Out of quota, or storage refused. Forgetting a filter is not worth a
      // line in a console an operator will never read.
    }
  }

  /** Strings only, and no empties — the shape the query builder expects. */
  private readFilters(filters: unknown): Readonly<Record<string, string>> {
    if (typeof filters !== 'object' || filters === null) return {};

    return Object.fromEntries(
      Object.entries(filters as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
      ),
    );
  }
}
