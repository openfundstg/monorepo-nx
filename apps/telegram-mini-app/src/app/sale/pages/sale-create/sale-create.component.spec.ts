import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { Store, provideStore } from '@ngrx/store';
import { SaleCreateComponent } from './sale-create.component';
import { SaleService } from '../../services/sale.service';
import { SALE_CONFIG_KEY } from '../../resolvers/sale-config.resolver';
import { ratesActions } from '../../../core/store/rates.actions';
import { ratesReducer } from '../../../core/store/rates.reducer';
import { RATES_FEATURE } from '../../../core/store/rates.state';
import {
  BankProvider,
  DEFAULT_MIN_ORDER_KOPECKS,
  ERROR,
  isSaleBankEnabled,
  MIN_USDT_AMOUNT,
  priceSale,
  priceStake,
  SaleMethod,
  SaleRemainderPolicy,
} from '@transacto/contracts';
import {
  DEFAULT_REMAINDER_POLICY,
  remainderPolicyOptions,
  SALE_BANKS,
} from '../../constants/sale-create.const';

/**
 * NEWBIE limit, and a round rate for the stubbed config. Deliberately not the
 * live rate — the arithmetic assertions below stay readable, and the component
 * takes the rate from `getConfig()`, which is the only place it has one.
 */
const KOPECKS_PER_USDT = 4000;

/** A NEWBIE's allowance: one sale at a time. */
const MAX_PARALLEL_ORDERS = 1;

/**
 * Available balance in **USDT cents** — 1 000 USDT, comfortably above the
 * ceiling so the balance rule never masks a limit assertion.
 */
const BALANCE_CENTS = 100_000;

describe('SaleCreateComponent validation', () => {
  let component: SaleCreateComponent;
  let fixture: ComponentFixture<SaleCreateComponent>;
  /** How many slots the stubbed config reports as taken. */
  let openOrders: number;
  /** Which of those are finished sales whose jars are still open. */
  let awaitingJar: { id: string; publicId: string; bankType: string; endedAt: string }[];
  /** What the next `getConfig()` answers with, so the market can move mid-test. */
  let sellRate: number;
  /** What `create()` does — resolved by default, rejected where that is the point. */
  let create: Mock;
  /** Answers with {@link config} as it stands when called, so a test can move the market first. */
  let getConfig: Mock;

  /** What the resolver hands the form — and what `getConfig()` re-reads on retry. */
  const config = () => ({
    trustLevel: 'NEWBIE',
    maxParallelOrders: MAX_PARALLEL_ORDERS,
    openOrders,
    slotsAwaitingJarClosure: awaitingJar,
    sellRate,
    // Without this every balance check reads `undefined` and the whole form
    // silently becomes invalid.
    balance: BALANCE_CENTS,
  });

  const build = async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        // The real rates slice, so the poll reaches the form through the same
        // selector the app wires up.
        provideStore({ [RATES_FEATURE]: ratesReducer }),
        {
          provide: SaleService,
          useValue: { getConfig, create },
        },
        // What the route's resolver put there. The form reads its figures from
        // here rather than fetching them, so that the screen is never drawn
        // from the defaults its signals were declared with.
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { [SALE_CONFIG_KEY]: config() } } },
        },
      ],
    });

    fixture = TestBed.createComponent(SaleCreateComponent);
    component = fixture.componentInstance;
    component.ngOnInit();
  };

  beforeEach(async () => {
    openOrders = 0;
    awaitingJar = [];
    sellRate = KOPECKS_PER_USDT;
    create = vi.fn().mockResolvedValue({ saleId: 'order-1' });
    getConfig = vi.fn(() => Promise.resolve(config()));
    TestBed.resetTestingModule();
    await build();
  });

  /** Everything the form needs, minus the amount. */
  /**
   * PrivatBank is the only bank open for new orders, and it names the card in
   * its own envelope record — so a complete form is one where the *bank* has
   * supplied the card, not one where a number has been typed.
   */
  const fillForm = () => {
    component.dropLink.set('https://next.privat24.ua/money-transfer/share/abc');
    component.cardNumber.set('4874100000003007');
    component.dropCardNumber.set('4874100000003007');
  };

  it('accepts a normal order', () => {
    // The reported bug: this form was complete and the button stayed disabled.
    // 10 USDT = 40000 kopecks, +1% = 40400, against a 500 USDT ceiling.
    fillForm();
    component.pricing.usdtAmount.set(10);

    expect(component.isValid()).toBe(true);
  });

  /**
   * A trust level no longer caps the size of an order — the stake bounds it —
   * so a large one is only refused when the balance cannot fund it.
   */
  it('accepts a large order, which no level ceiling refuses any more', () => {
    fillForm();
    component.pricing.usdtAmount.set(600);

    expect(component.isValid()).toBe(true);
  });

  describe('the parallel-order allowance', () => {
    it('leaves the form usable while a slot is free', () => {
      fillForm();
      component.pricing.usdtAmount.set(10);

      expect(component.pricing.slotsExhausted()).toBe(false);
      expect(component.isValid()).toBe(true);
    });

    it('refuses once the allowance is spent', async () => {
      openOrders = MAX_PARALLEL_ORDERS;
      TestBed.resetTestingModule();
      await build();

      fillForm();
      component.pricing.usdtAmount.set(10);

      expect(component.pricing.slotsExhausted()).toBe(true);
      expect(component.isValid()).toBe(false);
    });

    /**
     * Two ways to be out of slots, and only one of them is the user's to fix.
     *
     * A slot held by a *running* sale clears itself and there is nothing to do
     * but wait. A slot held by a *finished* sale clears only when its owner
     * closes the jar — so "finish the current one" is advice that can never be
     * followed, and the form has to say something else entirely.
     */
    describe('when a finished sale’s open jar is what is holding the slot', () => {
      const withOpenJar = async () => {
        openOrders = MAX_PARALLEL_ORDERS;
        awaitingJar = [
          {
            id: '000000000000000000000001',
            publicId: '8GJPNPDY',
            bankType: 'NOVAPAY',
            endedAt: '2026-09-05T11:32:54.582Z',
          },
        ];
        TestBed.resetTestingModule();
        await build();
      };

      it('says so, rather than blaming a sale that is running', async () => {
        await withOpenJar();

        expect(component.pricing.slotsExhausted()).toBe(true);
        expect(component.blockedByOpenJars()).toBe(true);
        expect(component.runningOrders()).toBe(MAX_PARALLEL_ORDERS - 1);
      });

      it('names the sale and its bank, so there is something to act on', async () => {
        await withOpenJar();

        expect(component.pricing.awaitingJarClosure()).toHaveLength(1);
        expect(component.pricing.awaitingJarClosure()[0].publicId).toBe('8GJPNPDY');
        expect(component.bankNameKey(BankProvider.NOVAPAY)).toBe('sale.bank_novapay');
      });

      /** A limit reached by sales that really are running is the other sentence. */
      it('does not claim an open jar when every slot is genuinely running', async () => {
        openOrders = MAX_PARALLEL_ORDERS;
        awaitingJar = [];
        TestBed.resetTestingModule();
        await build();

        expect(component.pricing.slotsExhausted()).toBe(true);
        expect(component.blockedByOpenJars()).toBe(false);
      });
    });

    /**
     * The allowance starts at zero and is only known once the config lands.
     * Reading that as "no slots left" would grey out the form on every load,
     * for the instant before the server answers.
     */
    it('does not read an unloaded allowance as exhausted', () => {
      component.pricing.maxParallelOrders.set(0);
      component.pricing.openOrders.set(0);

      expect(component.pricing.slotsExhausted()).toBe(false);
    });
  });

  it('rejects an amount below the minimum', () => {
    fillForm();
    component.pricing.usdtAmount.set(9);

    expect(component.isValid()).toBe(false);
  });

  it('rejects a card number that is not 16 digits', () => {
    fillForm();
    component.pricing.usdtAmount.set(10);
    component.cardNumber.set('487410003099');

    expect(component.isValid()).toBe(false);
  });

  it('accepts a card number typed with spaces', () => {
    fillForm();
    component.pricing.usdtAmount.set(10);
    component.cardNumber.set('4874 1000 0000 3007');

    expect(component.isValid()).toBe(true);
  });

  it('rejects a link that is not a URL', () => {
    fillForm();
    component.pricing.usdtAmount.set(10);
    component.dropLink.set('send.monobank.ua/jar/abc');

    expect(component.isValid()).toBe(false);
  });

  /**
   * The form marks nothing up. It is handed the sell rate finished and quotes
   * it verbatim: ₴40,00 per USDT, ten of them, ₴400 in the jar.
   *
   * It used to receive the market rate and a markup percentage and combine them
   * itself, which put a copy of the pricing rule on the client — and a client
   * that can price can disagree with the server that charges.
   */
  it('quotes the rate it was given and totals against it', () => {
    component.pricing.usdtAmount.set(10);

    expect(component.pricing.sellRateKopecks()).toBe(4_000);
    expect(component.pricing.targetKopecks()).toBe(40_000);
  });

  describe('the bank picker', () => {
    it('offers PrivatBank first', () => {
      expect(SALE_BANKS[0].provider).toBe(BankProvider.PRIVAT);
    });

    it('marks exactly one bank as recommended', () => {
      expect(SALE_BANKS.filter((bank) => bank.recommended)).toHaveLength(1);
    });

    /**
     * Recommending one bank while pre-selecting another is a disagreement that
     * only shows up in front of a user, so the default is derived from the flag
     * rather than named separately.
     */
    it('pre-selects the recommended bank', () => {
      const recommended = SALE_BANKS.find((bank) => bank.recommended);

      expect(component.selectedBank()).toBe(recommended?.provider);
    });

    /** Reordering the picker must never quietly drop a bank from it. */
    it('still offers every bank the contract defines', () => {
      const offered = new Set(SALE_BANKS.map((bank) => bank.provider));

      expect(offered).toEqual(new Set(Object.values(BankProvider)));
    });
  });

  /**
   * The client must agree with the server about what counts as a match. A form
   * stricter than the server refuses orders that would have run fine; a looser
   * one lets a user submit an order that is blocked on its first scrape, with
   * their stake already frozen.
   */
  describe('the remainder picker', () => {
    /**
     * The screen names the policy on every order it creates, so this is the
     * figure the server stores for anyone who never opens the section. It now
     * agrees with the server's own fallback, which it did not before —
     * `POST /tma/sales` used to default to WAIT_FOR_TOP_UP.
     */
    it('starts on refunding the remainder to the balance', () => {
      expect(component.remainderPolicy()).toBe(SaleRemainderPolicy.REFUND_TO_BALANCE);
    });

    /**
     * Pre-selecting a row the picker greys out would leave the screen with no
     * readable answer to what happens on submit — the radio would sit on an
     * option the click handler refuses. On this form that is not hypothetical:
     * waiting for the tail is the greyed row here.
     */
    it('starts on the first policy the picker offers', () => {
      expect(component.remainderPolicy()).toBe(DEFAULT_REMAINDER_POLICY);
    });

    /**
     * **A jar sale cannot be given the waiting ending**, so this form lists it
     * greyed. Which of the two is which lives in the contract — the same rule
     * the server refuses by — and the picker's own spec covers the rendering;
     * what this pins is that a jar form asks for the jar's options and not the
     * card's.
     */
    it('offers every policy the contract defines, waiting among them greyed', () => {
      const options = remainderPolicyOptions(SaleMethod.JAR);

      expect(new Set(options.map((option) => option.policy))).toEqual(
        new Set(Object.values(SaleRemainderPolicy)),
      );
      expect(
        options.find((option) => option.policy === SaleRemainderPolicy.WAIT_FOR_TOP_UP)?.comingSoon,
      ).toBe(true);
      expect(
        options.find((option) => option.policy === SaleRemainderPolicy.REFUND_TO_BALANCE)
          ?.comingSoon,
      ).toBeFalsy();
    });

    it('carries whichever policy is chosen into the order it creates', async () => {
      component.remainderPolicy.set(SaleRemainderPolicy.REFUND_TO_BALANCE);
      fillForm();
      component.pricing.usdtAmount.set(10);

      await component.onSubmit();

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE }),
      );
    });

    /**
     * The screen quotes this figure to the user — "anything under ₴300 comes
     * back" — so a stale copy would describe an offer the server does not make.
     * The stubbed config omits it, which is a server older than the field.
     */
    it('falls back to the contract floor when the config does not name one', () => {
      expect(component.pricing.minOrderKopecks()).toBe(DEFAULT_MIN_ORDER_KOPECKS);
    });
  });

  describe('the jar target tolerance', () => {
    it('accepts a jar set exactly to the target', () => {
      component.pricing.usdtAmount.set(10);
      component.jarGoal.set(component.pricing.targetKopecks());

      expect(component.goalMismatch()).toBe(false);
    });

    it.each([
      ['a hryvnia high', 100],
      ['a hryvnia low', -100],
    ])('accepts a jar set %s', (_label, offset) => {
      component.pricing.usdtAmount.set(10);
      component.jarGoal.set(component.pricing.targetKopecks() + offset);

      expect(component.goalMismatch()).toBe(false);
    });

    /**
     * The allowance scales with the order — one percent, with a hryvnia as the
     * floor — so a couple of hryvnia on a ₴404 target is a rounding rather than
     * a different jar. The same rule the server applies, from the same
     * function.
     */
    it.each([
      ['two hryvnia high', 200],
      ['two hryvnia low', -200],
    ])('accepts a jar set %s', (_label, offset) => {
      component.pricing.usdtAmount.set(10);
      component.jarGoal.set(component.pricing.targetKopecks() + offset);

      expect(component.goalMismatch()).toBe(false);
    });

    it.each([
      ['well over one percent high', 2_000],
      ['well over one percent low', -2_000],
    ])('flags a jar set %s', (_label, offset) => {
      component.pricing.usdtAmount.set(10);
      component.jarGoal.set(component.pricing.targetKopecks() + offset);

      expect(component.goalMismatch()).toBe(true);
    });

    /** `null` is "the bank did not say", never "does not match". */
    it('does not flag an unknown target', () => {
      component.pricing.usdtAmount.set(10);
      component.jarGoal.set(null);

      expect(component.goalMismatch()).toBe(false);
    });
  });

  describe('balance rule', () => {
    it('freezes only the pre-profit leg, so the requirement is the amount typed', () => {
      component.pricing.usdtAmount.set(10);

      // 40 400 kopecks target − 1% profit = 40 000 kopecks = 10 USDT = 1 000 cents.
      // Comparing `targetKopecks()` (40 400) against a cent balance instead
      // would overstate the requirement by a factor of the exchange rate.
      expect(component.requiredCents()).toBe(1_000);
      expect(component.requiredCents()).not.toBe(component.pricing.targetKopecks());
    });

    it('accepts an amount comfortably under the balance', () => {
      fillForm();
      component.pricing.usdtAmount.set(10);

      expect(component.pricing.hasSufficientBalance()).toBe(true);
      expect(component.isValid()).toBe(true);
    });

    it('accepts an amount exactly equal to the balance', () => {
      fillForm();
      component.pricing.usdtAmount.set(10);
      component.pricing.balanceCents.set(1_000);

      expect(component.requiredCents()).toBe(component.pricing.balanceCents());
      expect(component.pricing.hasSufficientBalance()).toBe(true);
      expect(component.isValid()).toBe(true);
    });

    it('rejects an amount one cent past the balance', () => {
      fillForm();
      component.pricing.usdtAmount.set(10);
      component.pricing.balanceCents.set(999);

      expect(component.pricing.hasSufficientBalance()).toBe(false);
      expect(component.isValid()).toBe(false);
    });

    /**
     * The reported bug: a user holding 10,02 USDT could stake at most 10,01.
     *
     * The target is derived from the typed amount and then the stake is derived
     * back out of the target, so quantising the target to the *nearest* hryvnia
     * could round it up and hand back a stake one cent above what was typed —
     * on roughly 29% of possible balances, whichever rate is live. Only whole
     * USDT amounts were immune, which is why every test above missed it.
     */
    it('lets a user stake a balance that is not a whole number of USDT', () => {
      fillForm();
      component.pricing.usdtAmount.set(10.02);
      component.pricing.balanceCents.set(1_002);

      expect(component.requiredCents()).toBeLessThanOrEqual(1_002);
      expect(component.pricing.hasSufficientBalance()).toBe(true);
      expect(component.isValid()).toBe(true);
    });

    /** The same property, stated over the range rather than at one point. */
    it('never quotes a stake above the amount typed', () => {
      fillForm();

      for (let cents = 1_000; cents <= 50_000; cents += 7) {
        component.pricing.usdtAmount.set(cents / 100);
        expect(component.requiredCents()).toBeLessThanOrEqual(cents);
      }
    });

    it('stays valid at the ceiling when the balance covers it', () => {
      fillForm();
      component.pricing.usdtAmount.set(495);

      expect(component.requiredCents()).toBe(49_500);
      expect(component.pricing.hasSufficientBalance()).toBe(true);
    });
  });

  /**
   * The form no longer carries a fallback rate, so an unreachable market has to
   * be visible rather than quoted around. It previously seeded ₴46.52 from a
   * constant and kept it for the whole session when config failed — every
   * figure on screen was then a price the server had never agreed to.
   */
  describe('when the exchange rate cannot be fetched', () => {
    beforeEach(async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([]),
          provideTranslateService(),
          provideStore({ [RATES_FEATURE]: ratesReducer }),
          {
            provide: SaleService,
            useValue: { getConfig: () => Promise.reject(new Error('503')) },
          },
          // `null` is exactly what the resolver produces when the call fails —
          // it resolves rather than rejecting, so the form is reached and can
          // say so, instead of the navigation being cancelled in silence.
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { data: { [SALE_CONFIG_KEY]: null } } },
          },
        ],
      });

      const fixture = TestBed.createComponent(SaleCreateComponent);
      component = fixture.componentInstance;
      component.ngOnInit();
    });

    it('says so instead of pricing the order itself', () => {
      expect(component.pricing.rateUnavailable()).toBe(true);
      expect(component.pricing.sellRateKopecks()).toBe(0);
    });

    it('refuses to submit', () => {
      component.dropLink.set('https://send.monobank.ua/widget.html?jar=abc');
      component.cardNumber.set('4874100000003007');
      component.pricing.usdtAmount.set(10);

      expect(component.isValid()).toBe(false);
    });

    /**
     * Nothing is priced without a rate: no total, nothing divided by zero, and
     * nothing to submit. The stake is the figure typed — it needs no rate to be
     * that — so it stays what was typed rather than becoming an Infinity.
     */
    it('does not divide by a rate of zero', () => {
      component.pricing.usdtAmount.set(10);

      expect(component.pricing.targetKopecks()).toBe(0);
      expect(component.requiredCents()).toBe(1_000);
      expect(component.pricing.isPriced()).toBe(false);
    });
  });

  /**
   * PrivatBank's envelope record names the card it pays into, so a card that
   * belongs to somebody else can be caught while the user is still in their
   * bank app. It used to surface only as a rejected submission, after they had
   * left it — the server has always refused the pair, and only the server did.
   */
  describe('the card against the link', () => {
    const JAR_CARD = '5168750000003407';

    /** As `resolveLink` leaves the form once a PrivatBank link is pasted. */
    const linkResolvedTo = (card: string | null) => {
      component.dropCardNumber.set(card);
      if (card) component.cardNumber.set(card);
    };

    it('accepts the card the bank named', () => {
      linkResolvedTo(JAR_CARD);

      expect(component.cardMismatch()).toBe(false);
    });

    /** The digits are what matter; a human types them in groups of four. */
    it('accepts the same card typed with spaces', () => {
      linkResolvedTo(JAR_CARD);
      component.cardNumber.set('5168 7500 0000 3407');

      expect(component.cardMismatch()).toBe(false);
    });

    it('rejects a different card', () => {
      linkResolvedTo(JAR_CARD);
      component.cardNumber.set('4874100000003205');

      expect(component.cardMismatch()).toBe(true);
    });

    /**
     * Sixteen digits arrive one keystroke at a time. Calling every prefix a
     * mismatch would put an error under the field for the whole time it is
     * being filled in.
     */
    it('stays quiet while the card is still being typed', () => {
      linkResolvedTo(JAR_CARD);
      component.cardNumber.set('4874 1000 3204');

      expect(component.cardMismatch()).toBe(false);
    });

    /** Monobank and PUMB name no card, so there is nothing to check against. */
    it('claims nothing when the bank named no card', () => {
      linkResolvedTo(null);
      component.cardNumber.set('4874100000003205');

      expect(component.cardMismatch()).toBe(false);
    });

    /** The button has to agree with the message under the field. */
    it('blocks the submit while the two disagree', () => {
      fillForm();
      component.pricing.usdtAmount.set(100);
      linkResolvedTo(JAR_CARD);
      component.cardNumber.set('4874100000003205');

      expect(component.isValid()).toBe(false);
    });

    it('lets the submit through once they agree', () => {
      fillForm();
      component.pricing.usdtAmount.set(100);
      linkResolvedTo(JAR_CARD);

      expect(component.isValid()).toBe(true);
    });

    /** Monobank is switched off, so the picker cannot move to it. */
    it('ignores a tap on a bank that is switched off', () => {
      linkResolvedTo(JAR_CARD);

      component.onSelectBank(BankProvider.MONO);

      expect(component.selectedBank()).toBe(BankProvider.PRIVAT);
      expect(component.dropCardNumber()).toBe(JAR_CARD);
    });

    /**
     * Switching banks drops what the previous link revealed. A verdict about
     * one bank's link says nothing about another's, and a card left over from
     * PrivatBank would be checked against a PUMB moneybox.
     */
    it('forgets the previous link when the bank changes', () => {
      linkResolvedTo(JAR_CARD);

      component.onSelectBank(BankProvider.PUMB);

      expect(component.selectedBank()).toBe(BankProvider.PUMB);
      expect(component.dropCardNumber()).toBeNull();
    });
  });

  /**
   * PrivatBank names the card in its own envelope record, so the account is not
   * a claim the user makes and we check — it is a fact the bank stated. The
   * server takes the bank's answer whatever is submitted, so an editable field
   * could only ever mislead.
   */
  /**
   * The floor was always enforced — `isValid()` refuses and the server answers
   * 1314 — but nothing on the screen named it, so an amount under it produced a
   * dead submit button and no reason for it.
   */
  describe('the minimum order', () => {
    it('refuses an amount under the floor', () => {
      fillForm();
      component.pricing.usdtAmount.set(9);

      expect(component.pricing.belowMinimum()).toBe(true);
      expect(component.isValid()).toBe(false);
    });

    it('accepts an amount exactly at the floor', () => {
      fillForm();
      component.pricing.usdtAmount.set(10);

      expect(component.pricing.belowMinimum()).toBe(false);
      expect(component.isValid()).toBe(true);
    });

    /**
     * An empty field is not a mistake. Complaining before anything has been
     * typed would greet every user with an error.
     */
    it.each([null, 0])('says nothing for %p', (amount) => {
      component.pricing.usdtAmount.set(amount as never);

      expect(component.pricing.belowMinimum()).toBe(false);
    });

    /**
     * The verdict turns over exactly at the contract's floor, so the figure the
     * screen shows and the one the server enforces cannot drift apart.
     */
    it('turns over exactly at the contracted floor', () => {
      fillForm();

      component.pricing.usdtAmount.set(MIN_USDT_AMOUNT - 1);
      expect(component.pricing.belowMinimum()).toBe(true);

      component.pricing.usdtAmount.set(MIN_USDT_AMOUNT);
      expect(component.pricing.belowMinimum()).toBe(false);
    });
  });

  describe('the card that comes from the link', () => {
    it('is not the user\'s to type for a bank that discloses it', () => {
      expect(component.cardIsFromBank()).toBe(true);
    });

    it('refuses to submit until the bank has named one', () => {
      component.dropLink.set('https://next.privat24.ua/money-transfer/share/abc');
      component.cardNumber.set('4874100000003007');
      component.pricing.usdtAmount.set(10);

      expect(component.dropCardNumber()).toBeNull();
      expect(component.isValid()).toBe(false);
    });

    /**
     * A link that resolved without a card is a dead end — the server refuses
     * such an order — so the screen has to say so rather than leave an empty
     * locked field with no explanation.
     */
    it('reports a resolved link that named no card', () => {
      component.linkResolved.set(true);
      component.dropCardNumber.set(null);

      expect(component.cardUnavailable()).toBe(true);
    });

    it('says nothing before the link has resolved', () => {
      component.linkResolved.set(false);
      component.dropCardNumber.set(null);

      expect(component.cardUnavailable()).toBe(false);
    });

    it('is satisfied once the bank names one', () => {
      fillForm();
      component.pricing.usdtAmount.set(10);
      component.linkResolved.set(true);

      expect(component.cardUnavailable()).toBe(false);
      expect(component.isValid()).toBe(true);
    });
  });

  /**
   * PUMB publishes twelve of sixteen digits. The field stays the user's to
   * fill — a mask cannot be paid into — but a card that disagrees with the
   * visible digits is caught here, in the form, while they still have their
   * banking app open.
   */
  /**
   * The link is usually pasted before the amount is typed, so the goal check
   * spends its first moments comparing a jar's target against nothing.
   */
  describe('the goal check as the amount changes', () => {
    it('complains while there is no amount yet', () => {
      component.jarGoal.set(80_000);

      expect(component.goalMismatch()).toBe(true);
    });

    /** The verdict must follow the amount, not the moment the link resolved. */
    it('clears itself the moment the amount makes the target fit', () => {
      component.pricing.usdtAmount.set(20);
      component.jarGoal.set(component.pricing.targetKopecks());

      expect(component.goalMismatch()).toBe(false);
    });

    /**
     * The fix for what reads as a stuck error: the check was always reactive,
     * but nothing on screen told the user which amount would satisfy it.
     */
    it('pulls the amount up to land exactly on the jar’s goal', () => {
      component.jarGoal.set(80_000);

      component.pullUpToGoal();

      expect(component.pricing.targetKopecks()).toBe(80_000);
      expect(component.pricing.amountField()).toBe((component.suggestedUsdtCents() ?? 0) / 100);
      expect(component.goalMismatch()).toBe(false);
      expect(component.goalDiffers()).toBe(false);
    });

    /** Nothing to aim at, nothing to offer — Monobank publishes no goal. */
    it('offers nothing when the link named no goal', () => {
      component.jarGoal.set(null);

      expect(component.suggestedUsdtCents()).toBeNull();
    });

    it('comes back when the amount moves away again', () => {
      component.pricing.usdtAmount.set(20);
      component.jarGoal.set(component.pricing.targetKopecks());
      component.pricing.usdtAmount.set(500);

      expect(component.goalMismatch()).toBe(true);
    });
  });

  describe('the card against a masked one', () => {
    const MASK = '53552800****0000';

    beforeEach(() => {
      component.dropCardNumber.set(null);
      component.dropCardMask.set(MASK);
    });

    it('accepts a card that fits the visible digits', () => {
      component.cardNumber.set('5355 2800 1234 0000');

      expect(component.cardMismatch()).toBe(false);
      expect(component.cardMatchesMask()).toBe(true);
    });

    /**
     * Valid or not, and never *why*. Printing the mask would hand anyone
     * holding a share link twelve of the card's sixteen digits — a check turned
     * into a lookup service.
     */
    it('never puts the published digits on screen', () => {
      component.cardNumber.set('5355 2800 1234 0000');

      expect(JSON.stringify(component.dropCardMask())).toContain('*');
      expect(component.cardMatchesMask()).toBe(true);
      // The verdict is a boolean. Nothing renders the mask itself; the i18n
      // drift guard would fail on a key that tried.
    });

    it('refuses one that cannot be behind the mask', () => {
      component.cardNumber.set('4149 2800 1234 0000');

      expect(component.cardMismatch()).toBe(true);
    });

    /** Sixteen digits arrive one keystroke at a time; a prefix is not a verdict. */
    it('says nothing while the field is still being filled in', () => {
      component.cardNumber.set('4149 2800');

      expect(component.cardMismatch()).toBe(false);
      // And no tick either: an incomplete card is not a verdict in either
      // direction.
      expect(component.cardMatchesMask()).toBe(false);
    });

    /**
     * With no mask and no card from the bank — Monobank — there is nothing to
     * check against, and the form must not invent a verdict.
     */
    it('says nothing at all when the bank published neither', () => {
      component.dropCardMask.set(null);
      component.cardNumber.set('4149 2800 1234 0000');

      expect(component.cardMismatch()).toBe(false);
    });
  });

  describe('banks that are switched off', () => {
    it('cannot be selected: MONO', () => {
      component.onSelectBank(BankProvider.MONO);

      expect(component.selectedBank()).toBe(BankProvider.PRIVAT);
    });

    /** The picker greys them out from the same list the server enforces. */
    it('reports which banks the picker may offer', () => {
      expect(isSaleBankEnabled(BankProvider.PRIVAT)).toBe(true);
      // Back on: its moneybox publishes the card masked, which is what the
      // dead-order rule used to have to discover the hard way.
      expect(isSaleBankEnabled(BankProvider.PUMB)).toBe(true);
      // Still off: a jar's card appears on the share screen and in no record,
      // so nothing can be checked before the stake is frozen.
      expect(isSaleBankEnabled(BankProvider.MONO)).toBe(false);
    });
  });

  /**
   * **The bug.** The form read the rate once, when the route resolved, and a
   * form left open for a minute went on quoting it — while the server took the
   * live one and froze a stake nobody had been shown. The form now follows the
   * app's rate poll, reads its figures again when the poll sees a rate it is
   * not priced at, and says what moved.
   */
  describe('when the market moves while the form is open', () => {
    /** The rate the market moves to in these tests: 1% above the quote. */
    const MOVED = KOPECKS_PER_USDT + 40;

    /** The poll landing on a new sell rate — and the server now quoting it. */
    const marketMovesTo = (sell: number) => {
      sellRate = sell;
      TestBed.inject(Store).dispatch(ratesActions.loadSuccess({ rates: { buy: sell - 100, sell } }));
    };

    /** Lets the background re-read the poll started run to its end. */
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    /**
     * The form's own first change detection, before the market moves.
     *
     * `build()` calls `ngOnInit` by hand, and the first time a test yields to
     * the event loop — as these do, for the re-read — zoneless change detection
     * runs the real first pass and calls it again. That second call re-seeds
     * the resolver's figures, which here means the rate from before the move:
     * a test artifact, since the app calls it once, but one that would hide
     * exactly what these tests are about.
     */
    beforeEach(async () => {
      await fixture.whenStable();
    });

    it('prices the form at the new rate', async () => {
      component.pricing.setAmount(10);

      marketMovesTo(MOVED);
      await settle();

      expect(getConfig).toHaveBeenCalledWith(true);
      expect(component.pricing.sellRateKopecks()).toBe(MOVED);
      expect(component.pricing.stakeCents()).toBe(1_000);
      expect(component.pricing.targetKopecks()).toBe(priceStake(1_000, MOVED).targetKopecks);
    });

    it('says what the rate was and what the figures were', async () => {
      component.pricing.setAmount(10);

      marketMovesTo(MOVED);
      await settle();

      expect(component.pricing.rateChange()).toEqual({
        rateKopecks: KOPECKS_PER_USDT,
        targetKopecks: 40_000,
        stakeCents: 1_000,
      });
    });

    /** The seller's own words: the goal is in the bank, the USDT is ours to move. */
    it('keeps a total held at the jar’s goal and moves the USDT instead', async () => {
      component.jarGoal.set(40_000);
      component.pullUpToGoal();

      marketMovesTo(MOVED);
      await settle();

      expect(component.pricing.targetKopecks()).toBe(40_000);
      expect(component.pricing.amountField()).toBe(priceSale(40_000, MOVED).requiredUsdtCents / 100);
      expect(component.goalDiffers()).toBe(false);
      expect(component.heldAtGoal()).toBe(true);
    });

    /**
     * A goal matched by typing is not held — typing is choosing the USDT — so a
     * move takes the total off it, and the way back is offered as a tap.
     */
    it('offers to pull the amount up to a goal the move took the total off', async () => {
      component.pricing.setAmount(10);
      component.jarGoal.set(component.pricing.targetKopecks());

      marketMovesTo(MOVED);
      await settle();

      expect(component.goalDiffers()).toBe(true);
      expect(component.suggestedUsdtCents()).toBe(priceSale(40_000, MOVED).requiredUsdtCents);

      component.pullUpToGoal();

      expect(component.pricing.targetKopecks()).toBe(40_000);
      expect(component.goalDiffers()).toBe(false);
    });

    it('asks nothing when the poll sees the rate the form is priced at', async () => {
      marketMovesTo(KOPECKS_PER_USDT);
      await settle();

      expect(getConfig).not.toHaveBeenCalled();
      expect(component.pricing.rateChange()).toBeNull();
    });
  });

  /**
   * The seconds between a move and the next poll, which the form cannot see.
   * The server refuses a quote at any rate but the live one, and the refusal
   * has to leave the form priced at that rate and saying so — not holding the
   * refused figures, where every further tap would fail the same way.
   */
  describe('when the server refuses a quote the market has moved under', () => {
    const readyToSubmit = () => {
      fillForm();
      component.pricing.setAmount(10);
      component.jarGoal.set(component.pricing.targetKopecks());
    };

    const refuseWithRateChanged = () =>
      create.mockRejectedValue({ error: { code: ERROR.SALE.RATE_CHANGED.code } });

    /** The form's own first pass first — see the block above for why. */
    beforeEach(async () => {
      await fixture.whenStable();
    });

    it('reads the rate again and reports the move in place of an error', async () => {
      readyToSubmit();
      refuseWithRateChanged();
      sellRate = KOPECKS_PER_USDT + 40;

      await component.onSubmit();

      expect(component.pricing.sellRateKopecks()).toBe(KOPECKS_PER_USDT + 40);
      expect(component.pricing.rateChange()?.rateKopecks).toBe(KOPECKS_PER_USDT);
      expect(component.submit.errorMsg()).toBe('');
    });

    /**
     * The poll can land its own re-read while the refused request is still
     * out. The move is then on screen before the refusal arrives, and the
     * sentence must still step aside for it — judged against the rate the
     * request quoted, not the one the form holds by the time it is refused.
     */
    it('lets the report speak when the move landed while the request was out', async () => {
      readyToSubmit();
      let refuse!: (reason: unknown) => void;
      create.mockReturnValue(
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
      );

      const submitted = component.onSubmit();
      sellRate = KOPECKS_PER_USDT + 40;
      TestBed.inject(Store).dispatch(
        ratesActions.loadSuccess({ rates: { buy: sellRate - 100, sell: sellRate } }),
      );
      await new Promise((resolve) => setTimeout(resolve));
      refuse({ error: { code: ERROR.SALE.RATE_CHANGED.code } });
      await submitted;

      expect(component.pricing.rateChange()?.rateKopecks).toBe(KOPECKS_PER_USDT);
      expect(component.submit.errorMsg()).toBe('');
    });

    /** The notice is what explains it; with nothing to report, the sentence must. */
    it('keeps the error when the re-read finds nothing new', async () => {
      readyToSubmit();
      refuseWithRateChanged();

      await component.onSubmit();

      expect(component.pricing.rateChange()).toBeNull();
      expect(component.submit.errorMsg()).not.toBe('');
    });

    /** Any other refusal is not a rate problem and re-reads nothing. */
    it('reads nothing again for an unrelated refusal', async () => {
      readyToSubmit();
      create.mockRejectedValue({ error: { code: 1303 } });

      await component.onSubmit();

      expect(getConfig).not.toHaveBeenCalled();
      expect(component.pricing.rateChange()).toBeNull();
    });
  });

  /**
   * Pulling the amount up to the jar's goal, and what the form lets through
   * afterwards.
   */
  describe('the pull-up to the jar’s goal', () => {
    /**
     * **The bug it had.** The form required the *typed* amount to reach ten on
     * top of the shared floor, so a goal worth 9.98 at the live rate — which
     * the floor and the server both accept — sat beside a disabled button.
     */
    it('lets a goal worth a little under ten USDT be sold', () => {
      fillForm();
      component.jarGoal.set(39_900);

      component.pullUpToGoal();

      expect(component.pricing.amountField()).toBe(9.98);
      expect(component.pricing.belowMinimum()).toBe(false);
      expect(component.isValid()).toBe(true);
    });

    it('holds the total until an amount is typed', () => {
      component.jarGoal.set(80_000);
      component.pullUpToGoal();

      component.pricing.setAmount(10);

      expect(component.heldAtGoal()).toBe(false);
      expect(component.pricing.targetKopecks()).toBe(40_000);
      expect(component.goalDiffers()).toBe(true);
    });

    it('does nothing without a goal to pull up to', () => {
      component.pricing.setAmount(10);
      component.jarGoal.set(null);

      component.pullUpToGoal();

      expect(component.pricing.heldTargetKopecks()).toBeNull();
      expect(component.pricing.targetKopecks()).toBe(40_000);
    });

    /** Sends the goal itself, so the server's stake is the one on screen. */
    it('submits the goal as the order’s total', async () => {
      fillForm();
      component.jarGoal.set(39_900);
      component.pullUpToGoal();

      await component.onSubmit();

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ fiatAmount: 39_900, stakeCents: 998, quotedRate: KOPECKS_PER_USDT }),
      );
    });
  });

  /**
   * **What the seller asked for: "if I type 10 USDT, it is 10 USDT".** The
   * order carries the stake typed, to the cent, beside its price rounded to
   * the nearest hryvnia — and the server freezes that stake as sent, after
   * checking the one is the price of the other.
   */
  describe('the order it sends', () => {
    /** ₴48.15: ten USDT is ₴481.50, the rate on which ten used to become 9.99. */
    const AWKWARD_RATE = 4_815;

    beforeEach(async () => {
      sellRate = AWKWARD_RATE;
      TestBed.resetTestingModule();
      await build();
    });

    it('sells exactly the USDT typed, for its price to the nearest hryvnia', async () => {
      fillForm();
      component.pricing.setAmount(10);

      await component.onSubmit();

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ stakeCents: 1_000, fiatAmount: 48_200, quotedRate: AWKWARD_RATE }),
      );
    });

    it('names the price where the jar’s goal has to match it', () => {
      component.pricing.setAmount(10);

      expect(component.pricing.targetKopecks()).toBe(48_200);
      expect(component.requiredCents()).toBe(1_000);
    });
  });
});