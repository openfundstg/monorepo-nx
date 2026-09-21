import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { AdminDocumentDisposition, AdminDocumentKind } from '@transacto/contracts';
import { DocumentFileService } from './document-file.service';
import { environment } from '../../../environments/environment';

/**
 * Where an operator's *open the document* link points.
 *
 * **It pointed at `/api/admin/admin/card-orders/…` and was answered `404`.**
 * `environment.apiUrl` already ends in `/admin`, and that was the one place
 * that wrote the base out by hand instead of asking `AdminHttpService` — so the
 * segment was there twice, and the only evidence for a disputed payment could
 * not be opened at all.
 *
 * This spec outlived the screen the bug was on. Three screens now offer the
 * link, so the path is built once and the old mistake has three times the
 * surface to come back on.
 */
describe('DocumentFileService', () => {
  const statement = { kind: AdminDocumentKind.SALE_STATEMENT, id: '6ab11d86e33833afd38430e0' };
  const receipt = { kind: AdminDocumentKind.FIAT_RECEIPT, id: '6ab11ec0f936db787dd83a84' };

  let service: DocumentFileService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient()],
    });

    service = TestBed.inject(DocumentFileService);
  });

  it('addresses a document by its kind and id, under the API base once', () => {
    expect(service.url(statement)).toBe(
      `${environment.apiUrl}/documents/${AdminDocumentKind.SALE_STATEMENT}/${statement.id}/file`,
    );
  });

  /** The bug, stated as the thing that must never come back. */
  it('never repeats the admin segment', () => {
    expect(service.url(statement)).not.toContain('/admin/admin/');
    expect(service.url(receipt, AdminDocumentDisposition.ATTACHMENT)).not.toContain('/admin/admin/');
  });

  /** Opening and saving are the same document asked for two ways. */
  it('asks for a download only when told to', () => {
    expect(service.url(receipt)).not.toContain('disposition=');
    expect(service.url(receipt, AdminDocumentDisposition.ATTACHMENT)).toContain(
      `disposition=${AdminDocumentDisposition.ATTACHMENT}`,
    );
  });
});
