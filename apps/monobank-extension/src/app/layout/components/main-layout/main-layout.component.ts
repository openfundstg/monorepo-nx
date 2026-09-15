import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '../header/header.component';

/** Width past which the popup is really a detached window, not the toolbar popup. */
const FULL_TAB_MIN_WIDTH_PX = 600;

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, HeaderComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainLayoutComponent {
  /** Read once: the popup cannot be resized after it opens. */
  readonly isFullTab = window.innerWidth > FULL_TAB_MIN_WIDTH_PX;
}
