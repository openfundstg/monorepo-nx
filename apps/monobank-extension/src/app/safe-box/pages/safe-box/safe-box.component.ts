import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { KopecksPipe } from '../../../shared/pipes/kopecks.pipe';
import { SafeBoxService } from '../../services/safe-box.service';
import type { SafeBoxEntry, SafeBoxMeta } from '../../interfaces/safe-box.interface';

const PAGE_SIZE = 20;

const EMPTY_META: SafeBoxMeta = { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 };

@Component({
  selector: 'app-safe-box',
  imports: [DatePipe, NgClass, TranslatePipe, FormsModule, KopecksPipe],
  templateUrl: './safe-box.component.html',
  styleUrl: './safe-box.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SafeBoxComponent implements OnInit {
  private readonly safeBoxService = inject(SafeBoxService);

  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  readonly data = signal<SafeBoxEntry[]>([]);
  readonly meta = signal<SafeBoxMeta>(EMPTY_META);

  readonly statusFilter = signal<string>('');
  readonly termFilter = signal<string>('');
  readonly currentPage = signal<number>(1);

  ngOnInit(): void {
    void this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await this.safeBoxService.list({
        page: this.currentPage(),
        limit: PAGE_SIZE,
        status: this.statusFilter() || undefined,
        term: this.termFilter() || undefined,
      });

      if (!response) {
        this.error.set('Failed to load data.');
        return;
      }

      this.data.set(response.data || []);
      this.meta.set(response.meta || EMPTY_META);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'An error occurred while loading data.');
    } finally {
      this.loading.set(false);
    }
  }

  onFilterChange(): void {
    this.currentPage.set(1);
    void this.loadData();
  }

  nextPage(): void {
    const { page, totalPages } = this.meta();
    if (page >= totalPages) return;

    this.currentPage.set(page + 1);
    void this.loadData();
  }

  prevPage(): void {
    const { page } = this.meta();
    if (page <= 1) return;

    this.currentPage.set(page - 1);
    void this.loadData();
  }
}
