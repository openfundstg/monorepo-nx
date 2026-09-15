import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  readonly authService = inject(AuthService);
  readonly router = inject(Router);
  readonly apiTokenInput = signal<string>('');
  readonly isLoggingIn = signal<boolean>(false);
  readonly translate = inject(TranslateService);

  async onLogin() {
    if (!this.apiTokenInput()) return;
    
    this.isLoggingIn.set(true);
    const success = await this.authService.login(this.apiTokenInput());
    this.isLoggingIn.set(false);

    if (!success) {
      alert(this.translate.instant('AUTH.LOGIN_FAILED'));
    } else {
      this.apiTokenInput.set(''); 
      this.router.navigate(['/']);
    }
  }
}
