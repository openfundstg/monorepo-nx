import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core'
import { Router } from '@angular/router'
import { TranslatePipe } from '@ngx-translate/core'
import { TmaService } from '../../../auth/services/tma.service'
import { MethodTileComponent } from '../../../shared/components/method-tile/method-tile.component'
import { SaleMethodIconComponent } from '../../../shared/components/sale-method-icon/sale-method-icon.component'
import { SaleMethod } from '@transacto/contracts'

/**
 * Where the hryvnia from a sale arrive, chosen before any form is opened — the
 * same step the top-up flow takes in front of its two forms.
 *
 * **The screen asks the server nothing, and both tiles are live on the first
 * frame.** It used to read a kill switch before deciding whether the card tile
 * led anywhere, so the tile changed after it was drawn: greyed and badged "in
 * development" on the first frame, live on the next. The switch went, and after
 * it a tap-to-reveal curtain that kept the built variant out of ordinary users'
 * way while it was tested against production. Both are gone; the card sale is
 * an ordinary way to sell.
 */
@Component({
  selector: 'app-sale-method',
  imports: [TranslatePipe, MethodTileComponent, SaleMethodIconComponent],
  templateUrl: './sale-method.component.html',
  styleUrl: './sale-method.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SaleMethodComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router)
  private readonly tma = inject(TmaService)

  /** Named for the template, which picks a glyph per tile. */
  protected readonly SaleMethod = SaleMethod

  ngOnInit(): void {
    this.tma.showBackButton(() => this.router.navigate(['/']))
  }

  ngOnDestroy(): void {
    this.tma.hideBackButton()
  }
}
