import { ChangeDetectionStrategy, Component, inject, ViewEncapsulation } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth/services/auth.service';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [TranslatePipe, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
  readonly authService = inject(AuthService);
  readonly translate = inject(TranslateService);

  constructor() {
    this.translate.addLangs(['en', 'uk', 'ru']);
    const browserLang = (chrome?.i18n?.getUILanguage() || navigator.language || 'en').split('-')[0];
    if (this.translate.getLangs().includes(browserLang)) {
      this.translate.use(browserLang);
    } else {
      this.translate.use('en');
    }
  }
}
