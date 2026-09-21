import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { AdminAmountCurrency } from '@transacto/contracts';
import { debounceTime } from 'rxjs';
import { FilterStorageService } from '../../services';

/** One choice in a select. `value` is what the query carries. */
export interface FilterOption {
  readonly value: string;
  /** Translation key. */
  readonly label: string;
}

/** Base units per whole unit, for both currencies. */
const SUBUNITS = 100;

/**
 * The narrowing both books offer, as one form.
 *
 * **One component because it mirrors one contract.** `AdminBookFilters` is the
 * same shape for sales and deposits — a date range, an amount range and which
 * figure it reads, a status, a person — which is exactly why the backend builds
 * both with one `bookFilterClauses`. Only the enumerations differ, and those
 * are inputs.
 *
 * Three things it deliberately does:
 *
 * - **Converts at the edge.** A person types hryvnia and USDT; the wire carries
 *   kopecks and cents, as it does everywhere else in this product. That
 *   conversion happens here and nowhere else, so nothing downstream has to know
 *   which of these values is a number at all.
 * - **Drops empties.** An absent filter and one set to `''` are different
 *   things to a backend that refuses the second, and the form is where a
 *   cleared field becomes absent.
 * - **Remembers, per viewer.** Which slice somebody works in is a working
 *   preference, not shared state — see `FilterStorageService`.
 */
@Component({
  selector: 'app-book-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
  ],
  templateUrl: './book-filters.component.html',
  styleUrl: './book-filters.component.scss',
})
export class BookFiltersComponent implements OnInit {
  /** Which list this is, so two books do not share one remembered slice. */
  readonly list = input.required<string>();
  /** The variants this book offers — a sale method, or a payment rail. */
  readonly variants = input.required<readonly FilterOption[]>();
  /** Translation key for the variant field's label. */
  readonly variantLabel = input('filters.variant');
  readonly statuses = input.required<readonly FilterOption[]>();

  /** What the list should now be narrowed to. Already in base units. */
  readonly apply = output<Readonly<Record<string, string>>>();

  private readonly fb = inject(FormBuilder);
  private readonly storage = inject(FilterStorageService);

  protected readonly Currency = AdminAmountCurrency;

  readonly expanded = signal(false);

  readonly form = this.fb.nonNullable.group({
    filter: '',
    from: '',
    to: '',
    currency: AdminAmountCurrency.UAH as AdminAmountCurrency,
    minAmount: '',
    maxAmount: '',
    status: '',
    telegramId: '',
  });

  private readonly value = toSignal(this.form.valueChanges.pipe(debounceTime(0)), {
    initialValue: this.form.getRawValue(),
  });

  /**
   * How many filters are actually narrowing anything.
   *
   * On the collapsed header, because a form that is folded away hides *why* a
   * list is short — and a short list under a forgotten filter reads exactly
   * like a book with nothing in it.
   */
  readonly activeCount = computed(() => Object.keys(this.toQuery()).length);

  /**
   * `ngOnInit`, not the constructor.
   *
   * A required input has no value while the component is being constructed —
   * the compiler says so — and this needs to know *which* list it is restoring
   * before it can read anything. An effect would work and would run later than
   * the first paint, which is one frame of an unfiltered book.
   */
  ngOnInit(): void {
    const remembered = this.storage.read(this.list());
    if (remembered === null) return;

    this.expanded.set(remembered.expanded);
    // `emitEvent: false`: restoring is not the operator narrowing anything, and
    // letting it through would fire a load before the list has entered — which
    // `bindListQuery` is about to do anyway, from the URL.
    this.form.patchValue(this.fromQuery(remembered.filters), { emitEvent: false });
    this.submit();
  }

  constructor() {
    this.form.valueChanges
      .pipe(debounceTime(FORM_SETTLE_MS), takeUntilDestroyed())
      .subscribe(() => this.submit());

    // Remembering is a side effect of the value, never of a click: a filter
    // changed and then navigated away from is still the one they were working
    // in.
    effect(() => {
      this.value();
      this.storage.write(this.list(), {
        filters: this.toQuery(),
        expanded: this.expanded(),
      });
    });
  }

  toggle(): void {
    this.expanded.set(!this.expanded());
    this.storage.write(this.list(), { filters: this.toQuery(), expanded: this.expanded() });
  }

  clear(): void {
    this.form.reset({ currency: AdminAmountCurrency.UAH });
  }

  submit(): void {
    this.apply.emit(this.toQuery());
  }

  /**
   * The form as the wire carries it.
   *
   * Empties are dropped rather than sent: the backend refuses an empty filter,
   * and rightly — a filter that matched nothing is indistinguishable from one
   * that was never applied.
   */
  private toQuery(): Readonly<Record<string, string>> {
    const raw = this.form.getRawValue();

    const entries: [string, string][] = [
      ['filter', raw.filter],
      ['from', raw.from],
      ['to', raw.to],
      ['status', raw.status],
      ['telegramId', raw.telegramId.trim()],
      ['minAmount', toSubunits(raw.minAmount)],
      ['maxAmount', toSubunits(raw.maxAmount)],
    ];

    const amounts = entries.filter(([key]) => key.endsWith('Amount')).some(([, value]) => value);

    return Object.fromEntries([
      ...entries.filter(([, value]) => value !== ''),
      // Only ever sent beside a bound. On its own it narrows nothing and would
      // count against the badge as though it did.
      ...(amounts ? ([['currency', raw.currency]] as [string, string][]) : []),
    ]);
  }

  /** The wire as the form shows it — the inverse, for what was remembered. */
  private fromQuery(filters: Readonly<Record<string, string>>): Record<string, string> {
    return {
      filter: filters['filter'] ?? '',
      from: filters['from'] ?? '',
      to: filters['to'] ?? '',
      currency: filters['currency'] ?? AdminAmountCurrency.UAH,
      minAmount: fromSubunits(filters['minAmount']),
      maxAmount: fromSubunits(filters['maxAmount']),
      status: filters['status'] ?? '',
      telegramId: filters['telegramId'] ?? '',
    };
  }
}

/** How long typing settles before the list is re-asked. */
const FORM_SETTLE_MS = 400;

/**
 * Hryvnia or USDT as a person typed it, in the base unit the wire carries.
 *
 * `''` for anything that is not a number, which is also how a cleared field
 * reads — both mean "no bound", and a `NaN` reaching the query would be a
 * filter nobody asked for.
 */
const toSubunits = (value: string): string => {
  const amount = Number(value.replace(',', '.').trim());

  return value.trim() === '' || !Number.isFinite(amount)
    ? ''
    : String(Math.round(amount * SUBUNITS));
};

const fromSubunits = (value: string | undefined): string => {
  const amount = Number(value);

  return value === undefined || !Number.isFinite(amount) ? '' : String(amount / SUBUNITS);
};
