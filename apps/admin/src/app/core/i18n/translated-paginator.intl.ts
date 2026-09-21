import { DestroyRef, inject, Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslateService } from '@ngx-translate/core';

/**
 * Material's paginator labels, translated.
 *
 * Without this the panel reads "Items per page: 25 · 1 – 1 of 1" in the middle
 * of an otherwise Ukrainian screen — Material ships English defaults and has no
 * hook into `ngx-translate`. `MatPaginatorIntl` is the supported way to replace
 * them, and it is a global provider because the paginator lives inside the
 * shared table component that every list renders.
 */
@Injectable()
export class TranslatedPaginatorIntl extends MatPaginatorIntl {
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    super();
    this.applyLabels();

    // Re-read and tell every live paginator to redraw. There is one language
    // today, so this fires once at startup — but a paginator still showing the
    // previous language after a change would be the kind of bug nobody thinks
    // to look for.
    const subscription = this.translate.onLangChange.subscribe(() => {
      this.applyLabels();
      this.changes.next();
    });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  /**
   * "41–60 з 812".
   *
   * Reimplemented rather than inherited because the base version hardcodes the
   * word "of". The arithmetic is Material's own, including the clamp that keeps
   * the upper bound honest when `length` has shrunk under a stale page index.
   */
  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0)
      return this.translate.instant('paginator.range_empty', { total: length });

    const total = Math.max(length, 0);
    const start = page * pageSize;
    const end = start < total ? Math.min(start + pageSize, total) : start + pageSize;

    return this.translate.instant('paginator.range', { start: start + 1, end, total });
  };

  private applyLabels(): void {
    this.itemsPerPageLabel = this.translate.instant('paginator.items_per_page');
    this.nextPageLabel = this.translate.instant('paginator.next');
    this.previousPageLabel = this.translate.instant('paginator.previous');
    this.firstPageLabel = this.translate.instant('paginator.first');
    this.lastPageLabel = this.translate.instant('paginator.last');
  }
}
