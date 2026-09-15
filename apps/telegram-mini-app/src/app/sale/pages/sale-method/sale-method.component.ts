import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core'
import { Router } from '@angular/router'
import { TranslatePipe } from '@ngx-translate/core'
import { TmaService } from '../../../auth/services/tma.service'
import { MethodTileComponent } from '../../../shared/components/method-tile/method-tile.component'

/**
 * Where the hryvnia from a sale arrive, chosen before any form is opened — the
 * same step the top-up flow takes in front of its two forms.
 *
 * Only the jar is built. The card is listed as coming rather than left out,
 * the way the sale form lists the remainder policy it does not have yet: an
 * option that says "not yet" answers a question a missing one leaves open.
 */
@Component({
  selector: 'app-sale-method',
  imports: [TranslatePipe, MethodTileComponent],
  templateUrl: './sale-method.component.html',
  styleUrl: './sale-method.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SaleMethodComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router)
  private readonly tma = inject(TmaService)

  ngOnInit(): void {
    this.tma.showBackButton(() => this.router.navigate(['/']))
  }

  ngOnDestroy(): void {
    this.tma.hideBackButton()
  }
}
