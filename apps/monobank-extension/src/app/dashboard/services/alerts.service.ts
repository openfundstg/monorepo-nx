import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AlertsApiService } from './alerts.api.service';

/**
 * Alert actions the trader can take from the dashboard.
 *
 * Each returns a boolean rather than throwing: these fire from click handlers
 * where a failed call should leave the UI usable, not surface a stack trace.
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private readonly api = inject(AlertsApiService);

  markAsRead(alertId: string): Promise<boolean> {
    return this.run(() => firstValueFrom(this.api.markAsRead(alertId)), 'mark alert as read');
  }

  acknowledge(alertId: string): Promise<boolean> {
    return this.run(() => firstValueFrom(this.api.acknowledge(alertId)), 'acknowledge alert');
  }

  moveToBox(alertId: string, amount: number, comment?: string | null): Promise<boolean> {
    return this.run(
      () => firstValueFrom(this.api.moveToBox(alertId, amount, comment)),
      'move alert to box',
    );
  }

  forceMatch(alertId: string, orderId: number, actualAmount: number): Promise<boolean> {
    return this.run(
      () => firstValueFrom(this.api.forceMatch(alertId, orderId, actualAmount)),
      'force match',
    );
  }

  private async run(call: () => Promise<unknown>, description: string): Promise<boolean> {
    try {
      await call();
      return true;
    } catch (err) {
      console.error(`Failed to ${description}`, err);
      return false;
    }
  }
}
