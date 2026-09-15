import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { authActions } from '../auth/store/auth.actions';
import { selectUsername } from '../auth/store/auth.selectors';
import { AdminSocketService } from '../core/services/admin-socket.service';
import { BrandMarkComponent } from '../shared/components/brand-mark/brand-mark.component';
import { NAV_SECTIONS } from './nav.const';

/**
 * The frame every screen renders inside: navigation, the signed-in operator,
 * and the live-connection indicator.
 *
 * The nav lives here rather than in each page for the reason it always does —
 * a nav inside a routed component is destroyed and rebuilt on every navigation,
 * which is visible as a flicker on every click.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe,
    BrandMarkComponent,
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly store = inject(Store);
  private readonly socket = inject(AdminSocketService);

  readonly sections = NAV_SECTIONS;
  readonly username = this.store.selectSignal(selectUsername);
  /**
   * Shown so an operator can tell a quiet system from a dropped socket.
   *
   * Without it, "nothing is updating" has two causes that look identical, and
   * the wrong one gets escalated.
   */
  readonly connected = this.socket.connected;

  logout(): void {
    this.store.dispatch(authActions.logout());
  }
}
