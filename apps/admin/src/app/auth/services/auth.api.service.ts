import { inject, Injectable } from '@angular/core';
import type { AdminLoginReq, AdminSessionRes } from '@transacto/contracts';
import type { Observable } from 'rxjs';
import { AdminHttpService } from '../../core/services/admin-http.service';

/** HTTP only. Every decision about a session lives in the effects. */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(AdminHttpService);

  login(credentials: AdminLoginReq): Observable<AdminSessionRes> {
    return this.http.command<AdminLoginReq, AdminSessionRes>('auth/login', credentials);
  }

  logout(): Observable<void> {
    return this.http.command<Record<string, never>, void>('auth/logout', {});
  }

  me(): Observable<AdminSessionRes> {
    return this.http.get<AdminSessionRes>('auth/me');
  }
}
