import { inject, Injectable } from '@angular/core';
import type { AdminOverviewRes } from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. */
@Injectable({ providedIn: 'root' })
export class OverviewApiService {
  private readonly http = inject(AdminHttpService);

  load(): Observable<AdminOverviewRes> {
    return this.http.get<AdminOverviewRes>('overview');
  }
}
