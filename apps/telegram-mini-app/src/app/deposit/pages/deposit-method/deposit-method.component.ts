import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TmaService } from '../../../auth/services/tma.service';
import { MethodTileComponent } from '../../../shared/components/method-tile/method-tile.component';

/**
 * The two ways to add money, offered before either form is opened.
 *
 * They are not variants of one screen: one asks for a USDT amount and a chain
 * transaction, the other reserves somebody's payout and takes a bank receipt.
 * Making the choice its own step is what keeps each form about one thing —
 * before this, the hryvnia route was a link at the bottom of the crypto form,
 * which is a poor place to discover a whole second product.
 */
@Component({
  selector: 'app-deposit-method',
  imports: [TranslatePipe, MethodTileComponent],
  templateUrl: './deposit-method.component.html',
  styleUrl: './deposit-method.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepositMethodComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly tma = inject(TmaService);

  /*
   * The `+0.5%` ribbon used to sit here, comparing the hryvnia route against
   * the market rate. Both are gone together: the market rate is no longer a
   * figure this app receives, because a rate a screen can read is a rate a
   * screen can quote, and two prices is the whole point.
   *
   * What it advertised is now said better on the dashboard, out of the only
   * two numbers there are — buy low, sell high, and the round trip is worth
   * about two and a half percent. That is a stronger claim than half a percent
   * off one leg, and it needs nothing that is not already on screen.
   */

  ngOnInit(): void {
    this.tma.showBackButton(() => this.router.navigate(['/']));
  }

  ngOnDestroy(): void {
    this.tma.hideBackButton();
  }
}
