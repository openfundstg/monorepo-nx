import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, runInInjectionContext, Injector, signal } from '@angular/core';
import { HttpRequest, HttpResponse, type HttpHandlerFn } from '@angular/common/http';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SessionService } from '../services/session.service';
import { API_TOKEN_HEADER, apiTokenInterceptor } from './api-token.interceptor';

describe('apiTokenInterceptor', () => {
  const token = signal<string | null>('trader-token');
  let injector: Injector;

  /** Runs the interceptor and hands back the request it actually forwarded. */
  const intercept = (req: HttpRequest<unknown>): HttpRequest<unknown> => {
    let forwarded!: HttpRequest<unknown>;
    const next: HttpHandlerFn = (r) => {
      forwarded = r;
      return of(new HttpResponse());
    };

    runInInjectionContext(injector, () => apiTokenInterceptor(req, next).subscribe());
    return forwarded;
  };

  beforeEach(() => {
    token.set('trader-token');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: SessionService, useValue: { token } },
      ],
    });
    injector = TestBed.inject(Injector);
  });

  it('attaches the token to our own API', () => {
    const forwarded = intercept(new HttpRequest('GET', `${environment.apiUrl}/extension/dashboard`));
    expect(forwarded.headers.get(API_TOKEN_HEADER)).toBe('trader-token');
  });

  it('never sends the token to another host', () => {
    // The trader's API token is a credential; leaking it to a third party
    // because a URL happened to pass through HttpClient would be a real breach.
    const forwarded = intercept(new HttpRequest('GET', 'https://example.com/anything'));
    expect(forwarded.headers.has(API_TOKEN_HEADER)).toBe(false);
  });

  it('leaves an explicitly supplied token alone', () => {
    // This is how login submits the token being tested rather than the stored one
    const req = new HttpRequest('POST', `${environment.apiUrl}/extension/auth`, {}, {
      headers: new HttpRequest('GET', '/').headers.set(API_TOKEN_HEADER, 'candidate-token'),
    });

    expect(intercept(req).headers.get(API_TOKEN_HEADER)).toBe('candidate-token');
  });

  it('passes the request through untouched when there is no session', () => {
    token.set(null);
    const forwarded = intercept(new HttpRequest('GET', `${environment.apiUrl}/extension/dashboard`));
    expect(forwarded.headers.has(API_TOKEN_HEADER)).toBe(false);
  });
});
