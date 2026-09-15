import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../auth/services/auth.service';
import { SocketService } from '../../../core/services/socket.service';

@Component({
  selector: 'app-header',
  imports: [TranslatePipe, RouterLink, RouterLinkActive],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  readonly authService = inject(AuthService);
  readonly socketService = inject(SocketService);
  readonly translate = inject(TranslateService);
  readonly router = inject(Router);

  async onLogout() {
    if (confirm(this.translate.instant('AUTH.LOGOUT'))) {
      await this.authService.logout();
      this.router.navigate(['/login']);
    }
  }

  async onDeactivate() {
    if (confirm(this.translate.instant('AUTH.DEACTIVATE'))) {
      try {
        await this.authService.deactivate();
        this.router.navigate(['/login']);
      } catch (err) {
        alert(this.translate.instant('AUTH.DEACTIVATE_FAILED'));
      }
    }
  }

  popOut() {
    chrome.windows.create({
      url: chrome.runtime.getURL('index.html'),
      type: 'popup',
      width: 400,
      height: 600,
    });
    window.close();
  }

  openSafeBox() {
    chrome.windows.create({
      url: chrome.runtime.getURL('index.html#/box'),
      type: 'popup',
      width: 800,
      height: 800,
    });
  }
}
