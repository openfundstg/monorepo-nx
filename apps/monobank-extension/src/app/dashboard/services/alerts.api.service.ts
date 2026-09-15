import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Transport only — every decision lives in `AlertsService`. */
@Injectable({ providedIn: 'root' })
export class AlertsApiService {
  private readonly http = inject(HttpClient);

  private get base(): string {
    return `${environment.apiUrl}/extension/alerts`;
  }

  markAsRead(alertId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${alertId}/read`, {});
  }

  acknowledge(alertId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${alertId}/acknowledge`, {});
  }

  moveToBox(alertId: string, amount: number, comment?: string | null): Observable<void> {
    return this.http.post<void>(`${this.base}/${alertId}/box`, { amount, comment });
  }

  forceMatch(alertId: string, orderId: number, actualAmount: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${alertId}/force-match`, { orderId, actualAmount });
  }
}
