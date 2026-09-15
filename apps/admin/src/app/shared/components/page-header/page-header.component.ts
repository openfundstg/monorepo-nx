import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** The title block every screen opens with, so none of them drifts on spacing. */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.scss',
})
export class PageHeaderComponent {
  /** Translation key. */
  readonly title = input.required<string>();
  /** Translation key. Omitted where the title says enough. */
  readonly subtitle = input<string | null>(null);
}
