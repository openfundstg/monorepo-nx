import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../../core/services/session.service';
import { AuthApiService } from './auth.api.service';

/**
 * Signing in, out, and deactivating.
 *
 * The session itself lives in `SessionService`; the signals are re-exposed here
 * so components and guards have a single thing to inject.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AuthApiService);
  private readonly session = inject(SessionService);

  readonly token = this.session.token;
  readonly traderId = this.session.traderId;
  readonly isInitializing = this.session.isInitializing;

  async login(apiToken: string): Promise<boolean> {
    try {
      const { traderId } = await firstValueFrom(this.api.login(apiToken));
      await this.session.persist(apiToken, traderId);
      return true;
    } catch (err) {
      console.error('Login failed', err);
      return false;
    }
  }

  /** Turns the trader off server-side, then clears the local session. */
  async deactivate(): Promise<void> {
    const traderId = this.traderId();
    if (!this.token() || !traderId) return;

    try {
      await firstValueFrom(this.api.deactivate(traderId));
      await this.session.clear();
    } catch (err) {
      console.error('Failed to deactivate', err);
      throw err;
    }
  }

  async logout(): Promise<void> {
    await this.session.clear();
  }
}
