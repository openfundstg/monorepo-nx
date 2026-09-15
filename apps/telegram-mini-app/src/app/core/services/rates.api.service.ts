import { Injectable, inject } from '@angular/core'
import { HttpClient, HttpContext } from '@angular/common/http'
import { Observable } from 'rxjs'
import type { TmaRatesResponse } from '@transacto/contracts'
import { environment } from '../../../environments/environment'
import { SKIP_LOADING } from '../../shared/constants/loading.const'

/** Transport only. */
@Injectable({ providedIn: 'root' })
export class RatesApiService {
  private readonly http = inject(HttpClient)

  /**
   * Every price in one call.
   *
   * Always background: this runs on a timer nobody asked for, and raising the
   * global overlay twice a minute would grey out whatever the user is reading
   * for no reason they could connect to anything they did.
   */
  getRates(): Observable<TmaRatesResponse> {
    return this.http.get<TmaRatesResponse>(`${environment.apiUrl}/rates`, {
      context: new HttpContext().set(SKIP_LOADING, true)
    })
  }
}
