import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The one search box, shared by every list.
 *
 * It does not debounce: the collection effect does, once, for all of them. A
 * component that debounced as well would double the delay and put the pacing in
 * two places, which is where a "search feels laggy" bug hides.
 */
@Component({
  selector: 'app-search-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatFormFieldModule, MatInputModule, MatIconModule, TranslatePipe],
  templateUrl: './search-field.component.html',
  styleUrl: './search-field.component.scss',
})
export class SearchFieldComponent {
  readonly value = input('');
  /** Translation key for the placeholder — each list says what it matches on. */
  readonly placeholder = input('common.search');
  readonly search = output<string>();

  onInput(event: Event): void {
    this.search.emit((event.target as HTMLInputElement).value);
  }
}
