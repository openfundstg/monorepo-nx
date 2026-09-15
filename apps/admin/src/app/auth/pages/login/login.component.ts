import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { BrandMarkComponent } from '../../../shared/components/brand-mark/brand-mark.component';
import { authActions } from '../../store/auth.actions';
import {
  selectAuthError,
  selectAuthLoading,
  selectSessionExpired,
} from '../../store/auth.selectors';

/**
 * The only unauthenticated screen.
 *
 * It shows the failure as a translated code and never as the message the server
 * sent — `message` is developer-facing English from the shared `ERROR`
 * constant, and the codes it can produce here are deliberately
 * indistinguishable between a wrong username and a wrong password.
 */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressBarModule,
    TranslatePipe,
    BrandMarkComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly store = inject(Store);
  private readonly fb = inject(FormBuilder);

  readonly loading = this.store.selectSignal(selectAuthLoading);
  readonly error = this.store.selectSignal(selectAuthError);
  /** Set when the session ended on its own, so the form explains why it is here. */
  readonly expired = this.store.selectSignal(selectSessionExpired);

  readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.store.dispatch(authActions.login({ credentials: this.form.getRawValue() }));
  }
}
