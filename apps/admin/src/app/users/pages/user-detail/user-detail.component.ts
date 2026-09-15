import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslatePipe } from '@ngx-translate/core';
import { StatusChipComponent } from '../../../shared/components';
import { DateTimePipe, UahPipe, UsdtPipe, UsdtWholePipe } from '../../../shared/pipes';
import { depositTone, flagTone, saleTone } from '../../../shared/utils';
import { UsersService } from '../../services/users.service';

/**
 * One user, with everything about them on one screen.
 *
 * The id arrives as a route input — `withComponentInputBinding()` is on — so
 * there is no `ActivatedRoute` subscription to leak and no `paramMap` to
 * re-read on a same-route navigation.
 */
@Component({
  selector: 'app-user-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    TranslatePipe,
    StatusChipComponent,
    UahPipe,
    UsdtPipe,
    UsdtWholePipe,
    DateTimePipe,
  ],
  templateUrl: './user-detail.component.html',
  styleUrl: './user-detail.component.scss',
})
export class UserDetailComponent {
  /** The route parameter, bound by the router. A string until it is parsed. */
  readonly telegramId = input.required<string>();

  private readonly usersService = inject(UsersService);

  readonly detail = this.usersService.detail;
  readonly loading = this.usersService.loading;

  readonly displayName = computed(() => {
    const user = this.detail()?.user;
    if (!user) return '';

    return user.username ? `@${user.username}` : [user.firstName, user.lastName].join(' ').trim();
  });

  protected readonly saleTone = saleTone;
  protected readonly depositTone = depositTone;
  protected readonly flagTone = flagTone;

  constructor() {
    // An effect, because the input is a signal and the load is a side effect on
    // it. It never writes another signal — the resource owns its own state.
    effect(() => this.usersService.load(Number(this.telegramId())));
  }
}
