import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SaleMethod } from '@transacto/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { SaleMethodIconComponent } from './sale-method-icon.component';

@Component({
  imports: [SaleMethodIconComponent],
  template: `<app-sale-method-icon [method]="method()" [size]="size()" />`,
})
class HostComponent {
  readonly method = signal(SaleMethod.JAR);
  readonly size = signal(24);
}

/**
 * The mark for where a sale pays out.
 *
 * **Two screens have to agree about these two shapes** — the method picker
 * offers them and the history list answers "which of those was this?" — so what
 * is worth pinning is that the two branches really are different drawings and
 * that neither hard-codes a colour a caller cannot override.
 */
describe('SaleMethodIconComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  const svg = (): SVGElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('svg');

  it('draws the jar for a jar sale', () => {
    expect(svg()?.querySelector('circle')).not.toBeNull();
  });

  it('draws the card for a card sale', async () => {
    host.method.set(SaleMethod.CARD);
    await fixture.whenStable();

    expect(svg()?.querySelector('circle')).toBeNull();
    expect(svg()?.querySelectorAll('path')).toHaveLength(2);
  });

  /** A history row sizes it against the bank logo it replaced, not against 24. */
  it('takes its size from the caller', async () => {
    host.size.set(22);
    await fixture.whenStable();

    expect(svg()?.getAttribute('width')).toBe('22');
    expect(svg()?.getAttribute('height')).toBe('22');
  });

  /**
   * `currentColor` and nothing else, which is what lets a disabled tile grey the
   * icon out without the icon knowing what a disabled tile is.
   */
  it('draws in the colour it inherits', () => {
    expect(svg()?.getAttribute('stroke')).toBe('currentColor');
  });
});
