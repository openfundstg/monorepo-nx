import { Directive, ElementRef, OnDestroy, OnInit, inject, input } from '@angular/core'
import { TourStep } from '../enums/tour-step.enum'
import { TourAnchorRegistryService } from '../services/tour-anchor-registry.service'

/**
 * Marks its host as the element a tour step highlights.
 *
 * ```html
 * <div class="balance-card" [appTourAnchor]="TourStep.BALANCE">…</div>
 * ```
 *
 * Lifecycle hooks rather than an `effect()`: registering writes a signal, and
 * an effect that writes a signal is the one thing effects may not do here. The
 * input is an enum member written in the template and never rebound, so
 * reading it once in `ngOnInit` is the whole contract — the doc on the
 * registry says why the unregister is guarded.
 */
@Directive({ selector: '[appTourAnchor]' })
export class TourAnchorDirective implements OnInit, OnDestroy {
  private readonly registry = inject(TourAnchorRegistryService)
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)

  readonly appTourAnchor = input.required<TourStep>()

  ngOnInit(): void {
    this.registry.register(this.appTourAnchor(), this.host.nativeElement)
  }

  ngOnDestroy(): void {
    this.registry.unregister(this.appTourAnchor(), this.host.nativeElement)
  }
}
