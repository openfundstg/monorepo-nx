import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { SaleCreateComponent } from './sale-create.component';
import { SaleService } from '../../services/sale.service';
import {
  BankProvider,
  DEFAULT_MIN_ORDER_KOPECKS,
  isSaleBankEnabled,
  MIN_USDT_AMOUNT,
  SaleRemainderPolicy,
} from '@transacto/contracts';
import {
  REMAINDER_POLICY_OPTIONS,
  isRemainderPolicyEnabled,
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
  /** How many slots the stubbed config reports as taken. */
  let openOrders: number;
  /** Which of those are finished sales whose jars are still open. */
  let awaitingJar: { id: string; publicId: string; bankType: string; endedAt: string }[];
  /** What the next `getConfig()` answers with, so the market can move mid-test. */
  let sellRate: number;
  /** What `create()` does — resolved by default, rejected where that is the point. */
  let create: Mock;

  const build = async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        {
          provide: SaleService,
          useValue: {
            getConfig: () =>
              Promise.resolve({
                trustLevel: 'NEWBIE',
                maxParallelOrders: MAX_PARALLEL_ORDERS,
                openOrders,
                slotsAwaitingJarClosure: awaitingJar,
                sellRate,
                // Without this every balance check reads `undefined` and the
                // whole form silently becomes invalid.
                balance: BALANCE_CENTS,
              }),
            create,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(SaleCreateComponent);
    component = fixture.componentInstance;
    await component.ngOnInit();
  };

  beforeEach(async () => {
    openOrders = 0;
    awaitingJar = [];
    sellRate = KOPECKS_PER_USDT;
    create = vi.fn().mockResolvedValue({ saleId: 'order-1' });
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
    component.usdtAmount.set(10);

    expect(component.isValid()).toBe(true);
  });

  /**
   * A trust level no longer caps the size of an order — the stake bounds it —
   * so a large one is only refused when the balance cannot fund it.
   */
  it('accepts a large order, which no level ceiling refuses any more', () => {
    fillForm();
    component.usdtAmount.set(600);

    expect(component.isValid()).toBe(true);
  });

  describe('the parallel-order allowance', () => {
    it('leaves the form usable while a slot is free', () => {
      fillForm();
      component.usdtAmount.set(10);

      expect(component.slotsExhausted()).toBe(false);
      expect(component.isValid()).toBe(true);
    });

    it('refuses once the allowance is spent', async () => {
      openOrders = MAX_PARALLEL_ORDERS;
      TestBed.resetTestingModule();
      await build();

      fillForm();
      component.usdtAmount.set(10);

      expect(component.slotsExhausted()).toBe(true);
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

        expect(component.slotsExhausted()).toBe(true);
        expect(component.blockedByOpenJars()).toBe(true);
        expect(component.runningOrders()).toBe(MAX_PARALLEL_ORDERS - 1);
      });

      it('names the sale and its bank, so there is something to act on', async () => {
        await withOpenJar();

        expect(component.awaitingJarClosure()).toHaveLength(1);
        expect(component.awaitingJarClosure()[0].publicId).toBe('8GJPNPDY');
        expect(component.bankNameKey(BankProvider.NOVAPAY)).toBe('sale.bank_novapay');
      });

      /** A limit reached by sales that really are running is the other sentence. */
      it('does not claim an open jar when every slot is genuinely running', async () => {
        openOrders = MAX_PARALLEL_ORDERS;
        awaitingJar = [];
        TestBed.resetTestingModule();
        await build();

        expect(component.slotsExhausted()).toBe(true);
        expect(component.blockedByOpenJars()).toBe(false);
      });
    });

    /**
     * The allowance starts at zero and is only known once the config lands.
     * Reading that as "no slots left" would grey out the form on every load,
     * for the instant before the server answers.
     */
    it('does not read an unloaded allowance as exhausted', () => {
      component.maxParallelOrders.set(0);
      component.openOrders.set(0);

      expect(component.slotsExhausted()).toBe(false);
    });
  });

  it('rejects an amount below the minimum', () => {
    fillForm();
    component.usdtAmount.set(9);

    expect(component.isValid()).toBe(false);
  });

  it('rejects a card number that is not 16 digits', () => {
    fillForm();
    component.usdtAmount.set(10);
    component.cardNumber.set('487410003099');

    expect(component.isValid()).toBe(false);
  });

  it('accepts a card number typed with spaces', () => {
    fillForm();
    component.usdtAmount.set(10);
    component.cardNumber.set('4874 1000 0000 3007');

    expect(component.isValid()).toBe(true);
  });

  it('rejects a link that is not a URL', () => {
    fillForm();
    component.usdtAmount.set(10);
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
    component.usdtAmount.set(10);

    expect(component.sellRateKopecks()).toBe(4_000);
    expect(component.targetKopecks()).toBe(40_000);
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
     * figure the server stores for anyone who never opens the section — not the
     * server's own fallback, which stays on WAIT_FOR_TOP_UP for older clients.
     */
    it('starts on refunding the remainder to the balance', () => {
      expect(component.remainderPolicy()).toBe(SaleRemainderPolicy.REFUND_TO_BALANCE);
    });

    /**
     * Pre-selecting a row the picker greys out would leave the screen with no
     * readable answer to what happens on submit — the radio would sit on an
     * option the click handler refuses.
     */
    it('starts on a policy the picker actually offers', () => {
      expect(isRemainderPolicyEnabled(component.remainderPolicy())).toBe(true);
    });

    it('greys out waiting for the full amount until it is built', () => {
      const comingSoon = REMAINDER_POLICY_OPTIONS.filter((option) => option.comingSoon);

      expect(comingSoon).toHaveLength(1);
      expect(comingSoon[0].policy).toBe(SaleRemainderPolicy.WAIT_FOR_TOP_UP);
      expect(isRemainderPolicyEnabled(SaleRemainderPolicy.WAIT_FOR_TOP_UP)).toBe(false);
    });

    /**
     * Listed rather than dropped: a greyed row with a badge answers "is this
     * coming", which a row removed from the picker does not.
     */
    it('lists every policy the contract defines', () => {
      expect(new Set(REMAINDER_POLICY_OPTIONS.map((option) => option.policy))).toEqual(
        new Set(Object.values(SaleRemainderPolicy)),
      );
    });

    it('takes a selection the picker offers', () => {
      for (const option of REMAINDER_POLICY_OPTIONS.filter((entry) => !entry.comingSoon)) {
        component.onSelectRemainderPolicy(option.policy);

        expect(component.remainderPolicy()).toBe(option.policy);
      }
    });

    /** The grey has to mean something, exactly as it does on the bank picker. */
    it('refuses a selection that is not built yet', () => {
      component.onSelectRemainderPolicy(SaleRemainderPolicy.WAIT_FOR_TOP_UP);

      expect(component.remainderPolicy()).toBe(SaleRemainderPolicy.REFUND_TO_BALANCE);
    });

    /**
     * The screen quotes this figure to the user — "anything under ₴300 comes
     * back" — so a stale copy would describe an offer the server does not make.
     * The stubbed config omits it, which is a server older than the field.
     */
    it('falls back to the contract floor when the config does not name one', () => {
      expect(component.minOrderKopecks()).toBe(DEFAULT_MIN_ORDER_KOPECKS);
    });
  });

  describe('the jar target tolerance', () => {
    it('accepts a jar set exactly to the target', () => {
      component.usdtAmount.set(10);
      component.jarGoal.set(component.targetKopecks());

      expect(component.goalMismatch()).toBe(false);
    });

    it.each([
      ['a hryvnia high', 100],
      ['a hryvnia low', -100],
    ])('accepts a jar set %s', (_label, offset) => {
      component.usdtAmount.set(10);
      component.jarGoal.set(component.targetKopecks() + offset);

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
      component.usdtAmount.set(10);
      component.jarGoal.set(component.targetKopecks() + offset);

      expect(component.goalMismatch()).toBe(false);
    });

    it.each([
      ['well over one percent high', 2_000],
      ['well over one percent low', -2_000],
    ])('flags a jar set %s', (_label, offset) => {
      component.usdtAmount.set(10);
      component.jarGoal.set(component.targetKopecks() + offset);

      expect(component.goalMismatch()).toBe(true);
    });

    /** `null` is "the bank did not say", never "does not match". */
    it('does not flag an unknown target', () => {
      component.usdtAmount.set(10);
      component.jarGoal.set(null);

      expect(component.goalMismatch()).toBe(false);
    });
  });

  describe('balance rule', () => {
    it('freezes only the pre-profit leg, so the requirement is the amount typed', () => {
      component.usdtAmount.set(10);

      // 40 400 kopecks target − 1% profit = 40 000 kopecks = 10 USDT = 1 000 cents.
      // Comparing `targetKopecks()` (40 400) against a cent balance instead
      // would overstate the requirement by a factor of the exchange rate.
      expect(component.requiredCents()).toBe(1_000);
      expect(component.requiredCents()).not.toBe(component.targetKopecks());
    });

    it('accepts an amount comfortably under the balance', () => {
      fillForm();
      component.usdtAmount.set(10);

      expect(component.hasSufficientBalance()).toBe(true);
      expect(component.isValid()).toBe(true);
    });

    it('accepts an amount exactly equal to the balance', () => {
      fillForm();
      component.usdtAmount.set(10);
      component.balanceCents.set(1_000);

      expect(component.requiredCents()).toBe(component.balanceCents());
      expect(component.hasSufficientBalance()).toBe(true);
      expect(component.isValid()).toBe(true);
    });

    it('rejects an amount one cent past the balance', () => {
      fillForm();
      component.usdtAmount.set(10);
      component.balanceCents.set(999);

      expect(component.hasSufficientBalance()).toBe(false);
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
      component.usdtAmount.set(10.02);
      component.balanceCents.set(1_002);

      expect(component.requiredCents()).toBeLessThanOrEqual(1_002);
      expect(component.hasSufficientBalance()).toBe(true);
      expect(component.isValid()).toBe(true);
    });

    /** The same property, stated over the range rather than at one point. */
    it('never quotes a stake above the amount typed', () => {
      fillForm();

      for (let cents = 1_000; cents <= 50_000; cents += 7) {
        component.usdtAmount.set(cents / 100);
        expect(component.requiredCents()).toBeLessThanOrEqual(cents);
      }
    });

    it('stays valid at the ceiling when the balance covers it', () => {
      fillForm();
      component.usdtAmount.set(495);

      expect(component.requiredCents()).toBe(49_500);
      expect(component.hasSufficientBalance()).toBe(true);
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
          {
            provide: SaleService,
            useValue: { getConfig: () => Promise.reject(new Error('503')) },
          },
        ],
      });

      const fixture = TestBed.createComponent(SaleCreateComponent);
      component = fixture.componentInstance;
      await component.ngOnInit();
    });

    it('says so instead of pricing the order itself', () => {
      expect(component.rateUnavailable()).toBe(true);
      expect(component.sellRateKopecks()).toBe(0);
    });

    it('refuses to submit', () => {
      component.dropLink.set('https://send.monobank.ua/widget.html?jar=abc');
      component.cardNumber.set('4874100000003007');
      component.usdtAmount.set(10);

      expect(component.isValid()).toBe(false);
    });

    it('does not divide by a rate of zero', () => {
      component.usdtAmount.set(10);

      expect(component.requiredCents()).toBe(0);
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
      component.usdtAmount.set(100);
      linkResolvedTo(JAR_CARD);
      component.cardNumber.set('4874100000003205');

      expect(component.isValid()).toBe(false);
    });

    it('lets the submit through once they agree', () => {
      fillForm();
      component.usdtAmount.set(100);
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
      component.usdtAmount.set(9);

      expect(component.belowMinimum()).toBe(true);
      expect(component.isValid()).toBe(false);
    });

    it('accepts an amount exactly at the floor', () => {
      fillForm();
      component.usdtAmount.set(10);

      expect(component.belowMinimum()).toBe(false);
      expect(component.isValid()).toBe(true);
    });

    /**
     * An empty field is not a mistake. Complaining before anything has been
     * typed would greet every user with an error.
     */
    it.each([null, 0])('says nothing for %p', (amount) => {
      component.usdtAmount.set(amount as never);

      expect(component.belowMinimum()).toBe(false);
    });

    /**
     * The verdict turns over exactly at the contract's floor, so the figure the
     * screen shows and the one the server enforces cannot drift apart.
     */
    it('turns over exactly at the contracted floor', () => {
      fillForm();

      component.usdtAmount.set(MIN_USDT_AMOUNT - 1);
      expect(component.belowMinimum()).toBe(true);

      component.usdtAmount.set(MIN_USDT_AMOUNT);
      expect(component.belowMinimum()).toBe(false);
    });
  });

  describe('the card that comes from the link', () => {
    it('is not the user\'s to type for a bank that discloses it', () => {
      expect(component.cardIsFromBank()).toBe(true);
    });

    it('refuses to submit until the bank has named one', () => {
      component.dropLink.set('https://next.privat24.ua/money-transfer/share/abc');
      component.cardNumber.set('4874100000003007');
      component.usdtAmount.set(10);

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
      component.usdtAmount.set(10);
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
      component.usdtAmount.set(20);
      component.jarGoal.set(component.targetKopecks());

      expect(component.goalMismatch()).toBe(false);
    });

    /**
     * The fix for what reads as a stuck error: the check was always reactive,
     * but nothing on screen told the user which amount would satisfy it.
     */
    it('offers the stake that lands exactly on the jar’s goal', () => {
      component.jarGoal.set(80_000);

      component.useSuggestedAmount();

      expect(component.usdtAmount()).toBe((component.suggestedUsdtCents() ?? 0) / 100);
      expect(component.goalMismatch()).toBe(false);
    });

    /** Nothing to aim at, nothing to offer — Monobank publishes no goal. */
    it('offers nothing when the link named no goal', () => {
      component.jarGoal.set(null);

      expect(component.suggestedUsdtCents()).toBeNull();
    });

    it('comes back when the amount moves away again', () => {
      component.usdtAmount.set(20);
      component.jarGoal.set(component.targetKopecks());
      component.usdtAmount.set(500);

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
   * The market moves while a form is being filled, and the server refuses a
   * quote it has moved out from under. Telling the user to change the jar's
   * goal is the wrong half to change: that is a minute inside a banking app,
   * and the rate moves again while they are in there. The amount is ours.
   */
  describe('when the market moves under the quote', () => {
    /** A complete form whose jar goal matches what the amount derives. */
    const readyToSubmit = () => {
      fillForm();
      component.usdtAmount.set(10);
      component.jarGoal.set(component.targetKopecks());
    };

    const refuseWithRateChanged = () =>
      create.mockRejectedValue({ error: { code: 1316 } });

    it('offers the amount that buys the same goal at the new rate', async () => {
      readyToSubmit();
      refuseWithRateChanged();
      // The rate the reload will find: 5% above what the form was quoted at.
      sellRate = KOPECKS_PER_USDT * 1.05;

      await component.onSubmit();

      expect(component.rateMoved()).toBe(true);
      expect(component.suggestedUsdtCents()).toBeGreaterThan(0);
    });

    it('takes the new amount without touching the jar’s goal', async () => {
      readyToSubmit();
      const goal = component.jarGoal();
      refuseWithRateChanged();
      sellRate = KOPECKS_PER_USDT * 1.05;

      await component.onSubmit();
      const offered = component.suggestedUsdtCents();
      component.useCurrentRate();

      expect(component.usdtAmount()).toBe((offered as number) / 100);
      expect(component.jarGoal()).toBe(goal);
      // And the form is submittable again: the target the new amount derives
      // matches the goal that never moved.
      expect(component.goalMismatch()).toBe(false);
      expect(component.rateMoved()).toBe(false);
    });

    /** Any other refusal is not a rate problem and gets no rate button. */
    it('offers nothing of the sort for an unrelated refusal', async () => {
      readyToSubmit();
      create.mockRejectedValue({ error: { code: 1303 } });

      await component.onSubmit();

      expect(component.rateMoved()).toBe(false);
    });
  });
});