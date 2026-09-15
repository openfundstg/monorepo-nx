import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { TranslatePipe } from '@ngx-translate/core';
import { Store } from '@ngrx/store';
import type { AdminSortDirection } from '@transacto/contracts';
import {
  CollectionTableComponent,
  PageHeaderComponent,
  SearchFieldComponent,
} from '../../../shared/components';
import { SUPPORT_TOPIC_COLUMNS, SUPPORT_USER_COLUMNS } from '../../constants/support-columns.const';
import { supportTopicsCollection, supportUsersCollection } from '../../store/support.collections';

/**
 * Two tabs over two collections.
 *
 * Each keeps its own paging and its own search, which is the point of the two
 * slices — switching tabs and back should return to what was being looked at
 * rather than to page one of a cleared filter.
 *
 * Both are dispatched `entered` on construction rather than on tab change: the
 * action is a no-op when a list is already loaded, and loading the second tab
 * up front means switching to it is instant.
 */
@Component({
  selector: 'app-support-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTabsModule,
    TranslatePipe,
    PageHeaderComponent,
    SearchFieldComponent,
    CollectionTableComponent,
  ],
  templateUrl: './support-list.component.html',
  styleUrl: './support-list.component.scss',
})
export class SupportListComponent {
  private readonly store = inject(Store);

  readonly topicColumns = SUPPORT_TOPIC_COLUMNS;
  readonly userColumns = SUPPORT_USER_COLUMNS;

  readonly topics = this.store.selectSignal(supportTopicsCollection.selectors.selectState);
  readonly users = this.store.selectSignal(supportUsersCollection.selectors.selectState);

  constructor() {
    this.store.dispatch(supportTopicsCollection.actions.entered());
    this.store.dispatch(supportUsersCollection.actions.entered());
  }

  onTopicSearch(search: string): void {
    this.store.dispatch(supportTopicsCollection.actions.searchChanged({ search }));
  }

  onTopicPage(event: { page: number; limit: number }): void {
    this.store.dispatch(supportTopicsCollection.actions.pageChanged(event));
  }

  onTopicSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(supportTopicsCollection.actions.sortChanged(event));
  }

  onTopicRefresh(): void {
    this.store.dispatch(supportTopicsCollection.actions.refreshed());
  }

  onUserSearch(search: string): void {
    this.store.dispatch(supportUsersCollection.actions.searchChanged({ search }));
  }

  onUserPage(event: { page: number; limit: number }): void {
    this.store.dispatch(supportUsersCollection.actions.pageChanged(event));
  }

  onUserSort(event: { sort: string; direction: AdminSortDirection }): void {
    this.store.dispatch(supportUsersCollection.actions.sortChanged(event));
  }

  onUserRefresh(): void {
    this.store.dispatch(supportUsersCollection.actions.refreshed());
  }
}
