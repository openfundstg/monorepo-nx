import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AdminSaleAction } from '@transacto/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { ColumnType } from '../../enums';
import type { ColumnDef, RowAction } from '../../interfaces';
import { CollectionTableComponent } from './collection-table.component';

interface Row {
  readonly id: string;
  readonly allowedActions: readonly AdminSaleAction[];
}

const COLUMNS: readonly ColumnDef<Row>[] = [
  { key: 'id', header: 'id', type: ColumnType.TEXT, value: (row) => row.id },
];

const ROW_ACTIONS: readonly RowAction<Row>[] = [
  {
    id: AdminSaleAction.CANCEL,
    label: 'cancel',
    icon: 'cancel',
    visible: (row) => row.allowedActions.includes(AdminSaleAction.CANCEL),
  },
  {
    id: AdminSaleAction.COMPLETE,
    label: 'complete',
    icon: 'done',
    visible: (row) => row.allowedActions.includes(AdminSaleAction.COMPLETE),
  },
];

/**
 * `visibleActions` decides whether a row shows a menu at all.
 *
 * Worth its own test because the failure it guards against is silent: an action
 * offered on a row that cannot accept it looks exactly like one that can, right
 * up to the point an operator clicks it. That shipped once — the sales
 * list offered all three interventions on a blocked order, where cancelling
 * answered 409 and blocking and completing did nothing at all.
 */
describe('CollectionTableComponent.visibleActions', () => {
  const build = (actions: readonly RowAction<Row>[] = ROW_ACTIONS) => {
    const fixture =
      TestBed.createComponent<CollectionTableComponent<Row>>(CollectionTableComponent);

    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', []);
    fixture.componentRef.setInput('total', 0);
    fixture.componentRef.setInput('page', 1);
    fixture.componentRef.setInput('limit', 25);
    fixture.componentRef.setInput('actions', actions);

    return fixture.componentInstance;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideTranslateService()],
    });
  });

  it('offers the actions a row declares', () => {
    const row: Row = { id: 'a', allowedActions: [AdminSaleAction.COMPLETE] };

    expect(
      build()
        .visibleActions(row)
        .map((action) => action.id),
    ).toEqual([AdminSaleAction.COMPLETE]);
  });

  /**
   * The regression. A row that accepts nothing must render no menu button at
   * all — the template guards on this list being non-empty, so an empty result
   * is what removes the trailing `⋮` rather than leaving one that opens onto
   * nothing.
   */
  it('offers nothing for a row that accepts nothing', () => {
    expect(build().visibleActions({ id: 'a', allowedActions: [] })).toEqual([]);
  });

  it('keeps an action that declares no visibility rule', () => {
    // Lists with unconditional actions — opening a user's card, say — must not
    // have their rows filtered out for lacking a predicate.
    const component = build([{ id: 'open', label: 'open', icon: 'open_in_new' }]);

    expect(component.visibleActions({ id: 'a', allowedActions: [] })).toHaveLength(1);
  });

  it('names the trailing actions column only when there are actions', () => {
    // Material needs every rendered column named; an actions column declared
    // with nothing to put in it renders an empty cell on every row.
    expect(build().displayedColumns()).toContain('__actions');
    expect(build([]).displayedColumns()).toEqual(['id']);
  });
});

/**
 * Which DOM row a pushed row lands on.
 *
 * **This tracked by the first column's value**, on a comment claiming that
 * column was always an id. It was an id on three lists out of thirteen; the
 * rest lead with `createdAt`, a terminal name or a person's display name. Two
 * rows sharing one — two receipts uploaded in the same millisecond, two jars
 * named the same thing, two people called the same thing — tracked as one row,
 * and a live push then updated whichever of them the differ happened to pair it
 * with. The collection already knew the answer; the table simply was not asked.
 */
describe('CollectionTableComponent.trackRow', () => {
  interface Named {
    readonly id: string;
    readonly name: string;
  }

  /** A list whose first column is a name, as ten of the thirteen effectively are. */
  const NAMED_COLUMNS: readonly ColumnDef<Named>[] = [
    { key: 'name', header: 'name', type: ColumnType.TEXT, value: (row) => row.name },
  ];

  const build = (rowId: ((row: Named) => string) | null) => {
    const fixture =
      TestBed.createComponent<CollectionTableComponent<Named>>(CollectionTableComponent);

    fixture.componentRef.setInput('columns', NAMED_COLUMNS);
    fixture.componentRef.setInput('rows', []);
    fixture.componentRef.setInput('total', 0);
    fixture.componentRef.setInput('page', 1);
    fixture.componentRef.setInput('limit', 25);
    fixture.componentRef.setInput('rowId', rowId);

    return fixture.componentInstance;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideTranslateService()],
    });
  });

  it('tells two rows apart when their first column reads the same', () => {
    const table = build((row) => row.id);

    const first = table.trackRow(0, { id: 'a', name: 'Каса №1' });
    const second = table.trackRow(1, { id: 'b', name: 'Каса №1' });

    expect(first).not.toBe(second);
  });

  it('gives one row the same identity wherever it sits on the page', () => {
    const table = build((row) => row.id);
    const row = { id: 'a', name: 'Каса №1' };

    expect(table.trackRow(0, row)).toBe(table.trackRow(7, row));
  });

  /**
   * The fallback is deliberately the index.
   *
   * Worse — every row re-renders on every push — but safe, where guessing from
   * a column silently pairs two different rows. Losing render work is
   * recoverable; showing one row's figures under another row's id is not.
   */
  it('falls back to the position when no identity is supplied', () => {
    const table = build(null);

    expect(table.trackRow(3, { id: 'a', name: 'Каса №1' })).toBe('3');
  });
});
