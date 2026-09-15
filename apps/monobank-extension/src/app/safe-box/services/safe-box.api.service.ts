import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { SafeBoxPage, SafeBoxQuery } from '../interfaces/safe-box.interface';

/** Transport only — every decision lives in `SafeBoxService`. */
@Injectable({ providedIn: 'root' })
export class SafeBoxApiService {
  private readonly http = inject(HttpClient);

  list(query: SafeBoxQuery): Observable<SafeBoxPage> {
    // HttpParams builds the query string; the old hand-rolled `'?' + k + '=' + v`
    // concatenation left a trailing '&' and never escaped the search term.
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }

    return this.http.get<SafeBoxPage>(`${environment.apiUrl}/extension/box/list`, { params });
  }
}
