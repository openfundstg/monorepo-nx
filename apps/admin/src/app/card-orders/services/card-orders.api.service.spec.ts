import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { CardOrdersApiService } from './card-orders.api.service';
import { environment } from '../../../environments/environment';

/**
 * Where an operator's *open the statement* link points.
 *
 * **It pointed at `/api/admin/admin/card-orders/…` and was answered `404`.**
 * `environment.apiUrl` already ends in `/admin`, and this was the one place
 * that wrote the base out by hand instead of asking `AdminHttpService` — so
 * the segment was there twice, and the only evidence for a disputed payment
 * could not be opened at all. It now joins the base where every other path
 * does.
 */
describe('CardOrdersApiService', () => {
  let service: CardOrdersApiService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient()],
    });

    service = TestBed.inject(CardOrdersApiService);
  });

  it('addresses the statement by the order number, under the API base once', () => {
    expect(service.statementUrl(2054424)).toBe(`${environment.apiUrl}/card-orders/2054424/statement`);
  });

  /** The bug, stated as the thing that must never come back. */
  it('never repeats the admin segment', () => {
    expect(service.statementUrl(2054424)).not.toContain('/admin/admin/');
  });
});
