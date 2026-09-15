import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TrackTapDirective } from './track-tap.directive';
import { MetaPixelService } from '../services/meta-pixel.service';
import { PixelTapEvent } from '../enums/pixel-event.enum';

@Component({
  imports: [TrackTapDirective],
  template: `
    <button [appTrackTap]="PixelTapEvent.START_DEPOSIT">deposit</button>
    <a [appTrackTap]="PixelTapEvent.NAV_SETTINGS">settings</a>
  `,
})
class HostComponent {
  protected readonly PixelTapEvent = PixelTapEvent;
}

describe('TrackTapDirective', () => {
  let trackAction: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;

  beforeEach(() => {
    trackAction = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: MetaPixelService, useValue: { trackAction } },
      ],
    });

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const tap = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(selector)?.dispatchEvent(
      new MouseEvent('click'),
    );

  it('reports the event it was given', () => {
    tap('button');

    expect(trackAction).toHaveBeenCalledWith(PixelTapEvent.START_DEPOSIT);
  });

  /** Anchors have no handler of their own to add a call to — that is the point. */
  it('works on an anchor as well as a button', () => {
    tap('a');

    expect(trackAction).toHaveBeenCalledWith(PixelTapEvent.NAV_SETTINGS);
  });

  it('reports nothing until something is tapped', () => {
    expect(trackAction).not.toHaveBeenCalled();
  });

  /**
   * A browser synthesises `click` for a touch, so listening for both would count
   * every tap on a phone twice — which is most of this app's traffic.
   */
  it('counts one tap once', () => {
    tap('button');
    tap('button');

    expect(trackAction).toHaveBeenCalledTimes(2);
    expect(trackAction).toHaveBeenNthCalledWith(1, PixelTapEvent.START_DEPOSIT);
  });
});
