import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { FocusReleaseService } from './focus-release.service';

/**
 * The tap that puts an iOS keyboard away.
 *
 * There is no other way out of one in a Telegram WebView: no system Back key,
 * no *Done* bar over a text field, and Telegram's own chrome is not the page.
 * A seller who opened "a different amount arrived" was left with half the
 * screen covered and nothing to press that closed it.
 */
describe('FocusReleaseService', () => {
  let service: FocusReleaseService;
  let field: HTMLInputElement;
  let elsewhere: HTMLDivElement;

  /**
   * A press, as the browser delivers one.
   *
   * `pointerdown` and not `click`, which is what the service listens for —
   * a click is 100–300 ms later and never arrives at all for a press that turns
   * into a scroll, which is exactly the gesture somebody makes when they are
   * trying to see past the keyboard.
   */
  const press = (target: Element): void => {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });

    service = TestBed.inject(FocusReleaseService);

    field = document.createElement('input');
    elsewhere = document.createElement('div');
    document.body.append(field, elsewhere);

    service.start();
  });

  afterEach(() => {
    field.remove();
    elsewhere.remove();
  });

  it('gives the caret up when the press lands on nothing', () => {
    field.focus();
    expect(document.activeElement).toBe(field);

    press(elsewhere);

    expect(document.activeElement).not.toBe(field);
  });

  it('leaves the caret alone when the press lands on the field itself', () => {
    field.focus();

    press(field);

    expect(document.activeElement).toBe(field);
  });

  /**
   * The tap usually lands on a `<span>` inside the label, which is not itself a
   * field — so the check has to walk up rather than look at the target's tag.
   * Blurring here would take the keyboard down a frame after the browser raised
   * it.
   */
  it('leaves it alone for a press inside a label that names one', () => {
    const label = document.createElement('label');
    const inner = document.createElement('span');

    label.append(inner);
    document.body.append(label);
    field.focus();

    press(inner);

    expect(document.activeElement).toBe(field);

    label.remove();
  });

  /**
   * **The bug this would otherwise have introduced.** Blurring dismisses the
   * keyboard, iOS scrolls the page back as it goes, and the `click` that was
   * about to be delivered lands wherever the target has moved to — so "confirm
   * this amount", the one button people press with the keyboard still up, would
   * have started needing two taps.
   */
  it('leaves the caret alone for a press on a button', () => {
    const button = document.createElement('button');
    const inner = document.createElement('span');

    button.append(inner);
    document.body.append(button);
    field.focus();

    press(inner);

    expect(document.activeElement).toBe(field);

    button.remove();
  });

  /**
   * Several components here call `stopPropagation` to keep outside-click
   * handlers of their own from firing. On the bubble phase this would simply
   * not run for those taps — and they are on the screens with the most
   * controls.
   */
  it('still fires when something between stops the event bubbling', () => {
    const shield = document.createElement('div');
    const inner = document.createElement('span');

    shield.append(inner);
    shield.addEventListener('pointerdown', (event) => event.stopPropagation());
    document.body.append(shield);
    field.focus();

    press(inner);

    expect(document.activeElement).not.toBe(field);

    shield.remove();
  });

  /** Nothing is focused, so there is nothing to give up and nothing to do. */
  it('does nothing when the page holds no caret', () => {
    const blur = vi.spyOn(HTMLElement.prototype, 'blur');

    press(elsewhere);

    expect(blur).not.toHaveBeenCalled();

    blur.mockRestore();
  });

  /** Idempotent, in the manner of `ZoomLockService.lock`. */
  it('binds once however many times it is started', () => {
    const add = vi.spyOn(document, 'addEventListener');

    service.start();
    service.start();

    expect(add).not.toHaveBeenCalled();

    add.mockRestore();
  });
});
