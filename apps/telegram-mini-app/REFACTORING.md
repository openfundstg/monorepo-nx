# Refactoring Backlog — Telegram Mini App

Where the current code diverges from [CLAUDE.md](./CLAUDE.md) and
[.claude/skills/angular-structure/SKILL.md](.claude/skills/angular-structure/SKILL.md).

**This is a backlog, not a precedent.** New code follows the rules; existing code listed here
is scheduled for the structural refactor. Don't copy these patterns.

---

## 1. Three-file rule — ✅ DONE

All six pages plus the root `App` were a single `.ts` with an inline `template:` and `styles:`.
Each is now `.ts` + `.html` + `.scss` in its own folder.

## 2. Module layout — ✅ DONE

`app/core/{i18n,interceptors,services}` + `app/features/**` is gone. The app is now
`app/{auth,dashboard,deposit,sale,settings,user,realtime,shared}/`, each feature lazily
loaded from its own `routes.ts`. `core/` no longer exists at all — nothing in it was an app-wide
singleton once `ApiService` was split and `TranslationService` deleted. (`wallet/` was in this
list until it was folded into the dashboard — see 2b.)

The monolithic `core/services/api.service.ts` became one `*.api.service.ts` per module, each
paired with a `*.service.ts` that owns the decisions:

| Module | API service | Service |
|---|---|---|
| `auth` | `auth.api.service.ts` | `auth.service.ts` |
| `user` | `user.api.service.ts` | `user.service.ts` |
| `deposit` | `deposit.api.service.ts` | `deposit.service.ts` |
| `sale` | `sale.api.service.ts` | `sale.service.ts` |

The service layer also unwraps the single-key envelopes (`{ deposits }`, `{ order }`,
`{ history }`) so components receive the payload itself.

## 2b. `/wallet` was unreachable, and is now deleted — ✅ CLOSED

`app.routes.ts` had no `wallet` route, but the bottom nav and the dashboard both link to it
(`routerLink="/wallet"`, `navigate(['/wallet'])`). Every attempt to open the wallet hit the
`path: '**'` wildcard and silently redirected back to the dashboard — so a 245-line page listing
balance, deposits and sales was dead in the running app while looking perfectly alive in
the source.

Adding the route made it reachable, and that answered the question the bug had hidden: the page
showed balance, deposits and sales, which is what the dashboard already showed. **The
wallet was therefore folded into the dashboard and `app/wallet/**` deleted**, rather than kept as
a second view of the same data:

- the three history tabs and the empty state moved onto the dashboard, and `WalletTab` became
  `HistoryTab` in `shared/enums/history-tab.enum.ts` (see 4);
- the `wallet.*` translation keys were retired in favour of `dashboard.tab_*`,
  `dashboard.deposits`, `dashboard.scrolls` and `dashboard.empty_history`;
- the `wallet` route and its comment left `app.routes.ts`; navigation into the wallet became
  navigation to `/` (`deposit-verify`'s `goToWallet()` is now `goToDashboard()`);
- `shared/components/bottom-nav/` links Home and Settings; nothing links to `/wallet`.

The crypto deposit address on `deposit-verify` is still called `walletAddress`, and the
`deposit.wallet_address` key with it. That is the on-chain address, unrelated to the page that
was deleted.

## 3. Shell folders — ✅ DONE

| Item | Now |
|---|---|
| Global styles | `src/styles.scss` |
| Environments | `src/environments/environment.ts` + `.prod.ts`, swapped by `fileReplacements` |
| API base URL | `environment.apiUrl` — no longer inlined in a service |
| Assets | `src/assets/` wired into the build target |

⬜ `src/styles/` partials and `src/fonts/` — create when first needed.

## 4. Enums and constants — ✅ DONE

- `wallet.component.ts` — `'history' | 'deposits' | 'sales'` → `WalletTab` enum, compared
  against members in both the class and the template. The enum outlived the page: it is now
  `HistoryTab` in `shared/enums/history-tab.enum.ts`, and the dashboard uses it.
- `dashboard.component.ts` — the two turnover milestones and the progress bar's 40/100 split were
  bare numbers inside a `computed`. They are now `TurnoverThreshold` / `TurnoverProgress`
  `as const` groups in `dashboard/enums/turnover-threshold.enum.ts`, expressed in kopecks so they
  mirror `TRUST_LEVELS[*].minTurnover` on the backend without a conversion in between.
- `sale-create.component.ts` — `'MONO' | 'PRIVAT' | 'PUMB'` → `BankProvider` from
  contracts, so the mini app, the extension and the backend all name banks the same way.
- `TrustLevel` was already an enum in contracts; the local string union died with
  `core/models/`.

## 5. i18n → `ngx-translate` — ✅ DONE

- `core/i18n/{en,ru,uk}.ts` and `core/services/translation.service.ts` deleted.
- Dictionaries moved to `src/assets/i18n/*.json`, **nested** rather than flat: ngx-translate
  resolves `dashboard.title` by splitting on the dot, so a literal `"dashboard.title"` key would
  never have matched.
- `{{ t()('k') }}` → `{{ 'k' | translate }}` across 72 call sites, including the dynamic ones
  (`'trust.' + level | translate`) and the four attribute bindings.
- Two `| translate || 'fallback'` leftovers removed — the pipe binds looser than `||`, so those
  were a parse error waiting to happen, and the fallback is redundant now the keys exist.

**The dictionaries were not equivalent.** uk had 83 keys, en 81, ru 77 — so `dashboard.frozen`,
three `status.*` keys and two `scroll.amount_usdt_*` keys rendered as raw dotted strings for
Russian users. All three are now 145 keys and verified equal, including the `dashboard.tab_*` /
`dashboard.empty_history` keys that replaced hardcoded Ukrainian (the wallet page's originals,
then the dashboard's own — see 10).

That equality is no longer maintained by hand: `shared/i18n.spec.ts` fails `nx test` when the
three files disagree on their key set, when a value is blank, or when a `{{placeholder}}` exists
in one language and not another. It also pins the keys that are only ever built by concatenation
(`'status.' + …`, `'SALE_EVENT.' + …`, `'trust.' + …`), because those names appear nowhere in
the source for a grep to find before someone deletes one.

## 6. Change detection — ✅ DONE

`ChangeDetectionStrategy.OnPush` on every component; the redundant `standalone: true` dropped.

## 7. Server errors were shown in English — ✅ DONE

`deposit-verify` and `sale-create` displayed `err?.error?.message` — the backend's
developer-facing English string — to a trader using the app in Ukrainian or Russian.

`shared/services/api-error.service.ts` now maps the numeric `code` from the `ERROR` body onto an
`ERRORS.<code>` translation, with a generic translated fallback and a `console.warn` when a code
has no entry. The `message` field is deliberately never displayed. All 26 codes the mini app can
receive are translated in three languages, and the copy is rewritten for users: "Your session has
expired. Please reopen the app." rather than "initData has expired".

## 8. Sale could never be submitted — ✅ FIXED

Reported: the form was filled in correctly and "Підтвердити прокрутку" stayed disabled.

`isValid` compared `targetUah <= maxSale`. Both names lie about their units:

| value | actual unit |
|---|---|
| `targetUah` (now `targetKopecks`) | kopecks — `usdtAmount × exchangeRate`, where the rate is kopecks per USDT |
| `maxSale` | **USDT** — the server checks `fiatAmount > maxSale * exchangeRate`, and its error says "max: N USDT" |

So a 10 USDT order compared 40 400 against 500 and always lost, by a factor of the exchange
rate. The button could not enable for any amount at any trust level.

The neighbouring `isAmountValid` was fine precisely because it compares USDT to USDT, which is
what made the bug look like a puzzle rather than a mismatch.

Fixed by converting the ceiling once (`maxSaleKopecks`), renaming the three kopeck-valued
computeds so the unit is visible at the call site, and naming the `10` and `16` literals. The
contract now documents that `maxSale` is USDT while everything around it is kopecks.

## 9. The frozen balance was declared but never sent — ✅ FIXED

The dashboard rendered `dashboard.frozen` from `user.frozenBalance`, a field `TmaUser` has always
declared — but neither `POST /api/tma/auth` nor `GET /api/tma/user/profile` put it in the
response body. It read `undefined`, `?? 0` turned that into zero, and the `> 0` guard then hid
the row entirely. A trader with funds locked in an open sale saw no mention of them.

Both controllers now return the field. Listed here rather than only in the API's backlog because
the symptom was a mini-app screen and the contract had promised the value all along.

`GET /user/profile` also used to answer HTTP 200 with `{ error: 'User not found…' }`, which every
client read as success and then dereferenced. It throws 404 now, as `GET /sales/:id` does.

## 10. Hardcoded Ukrainian on the dashboard — ✅ DONE

The history tabs (`Усі операції`, `Поповнення`, `Прокрутки`), the empty state (`Історія порожня`)
and the literal `UAH` / `USDT` suffixes were typed into the template, so those parts of the
screen stayed Ukrainian whatever the selected language was. They now go through
`dashboard.tab_*`, `dashboard.empty_history` and
`common.uah` / `common.usdt`; the bank name in an activity row is `'scroll.bank_' + bankType`,
including the image's `alt`.

Status comparisons in the same template moved from string literals to `TmaDepositStatus` /
`TmaSaleStatus` members, and the trust badge falls back to `TrustLevel.NEWBIE` rather than
the string `'NEWBIE'`.

## 11. Money and date formatting was copy-pasted — ✅ DONE

`formatUah` / `formatUsdt` / `formatDateTime` existed byte for byte in several components, and
each copy quietly decided its own units — which is how the dashboard and the (now deleted) wallet
page came to disagree about whether a history amount was kopecks or cents.

They live once in `shared/utils/format.util.ts` for `.ts` callers, with `UahPipe` (`uah`),
`UsdtPipe` (`usdt`) and `DateTimePipe` (`dateTime`) in `shared/pipes/` delegating to them for
templates. The locale is pinned to `uk-UA` and deliberately does not follow the interface
language: the only fiat in the product is the hryvnia, and a pipe that re-formatted on a language
change would have to be impure.

## 12. The interface language could not be changed — ✅ DONE

The language was whatever Telegram's `language_code` said, for the lifetime of the install.
`settings/` is a new module with one page: a picker, plus `LanguageService` and
`TmaStorageService` in `shared/services/`.

A stored choice outranks `language_code` on every subsequent open — someone who switched to
English inside a Ukrainian-locale client meant it. Persistence is Telegram CloudStorage with a
`localStorage` fallback, and neither `get` nor `set` ever rejects: a wedged bridge must degrade
to "no stored preference", not hang app boot behind an `await` that never settles.

The picker's own rows are **endonyms** (`Українська`, `English`, `Русский`) and are not
translation keys. A picker that translates its options is unreadable to exactly the person who
opened it.

## 13. A sale gave no feedback while it ran — ✅ DONE

After submitting, the status page showed a fixed set of steps and the amount the trader had
typed. Everything the backend learned afterwards — orders arriving, payments matched, the jar
balance — was invisible until a manual reload, on a screen a trader watches for minutes.

`GET /api/tma/sales/:id/progress` and the `sale.progress` socket event now feed a
`SaleProgress` snapshot: received against target, jar balance, pending order count and
sum, and an event timeline rendered from `'SALE_EVENT.' + event.type` with pre-formatted
amounts. The push is a **complete snapshot, not a delta**, so the page replaces its state instead
of merging — there is no dedupe to write. `WsService` listens by `TmaWsEventNames` member rather
than by raw event-name string.

`jarBalance` is nullable and `null` means *not scraped yet*. It renders as
`scroll.jar_balance_unknown`, never as ₴0 — a trader reading zero would conclude their money had
vanished.

---

## Still open

- ✅ The app now has a `test` target (`@angular/build:unit-test` + vitest, mirroring the
  extension) and real coverage where it has already been burned: `src/test-setup.ts` stubs
  `Telegram.WebApp`, `sale-create.component.spec.ts` pins the amount, limit and balance
  rules on the form where a unit bug once made submission impossible, and `shared/i18n.spec.ts`
  guards the three dictionaries (see 5). The mini app previously had no tests at all.
- ⬜ The `deposit/` module is the last holdout: `deposit-verify.component.ts` still has
  `signal<any>`, `timerInterval: any`, `catch (err: any)` and its own `formatUah` / `formatUsdt`,
  and `deposit-create.component.ts` its own `formatUah` — the duplication section 11 removed
  everywhere else.
- ⬜ `src/styles/` partials — `app.scss` and the per-page `.scss` files repeat the same
  `.glass-card`, `.primary-btn`, `.spinner` rules.


## Decided

i18n is **`ngx-translate`** with `src/assets/i18n/*.json` — no `@angular/localize`, no `.xlf`.


---

## The remainder picker

The create form now asks what should happen to a tail no payment can cover — the last stretch
under ₴300, which the payment pipeline cannot route an order for.

Two things about it are deliberate and easy to undo by accident:

- **The recommended option is not the pre-selected one.** `DEFAULT_REMAINDER_POLICY` is named
  outright rather than derived from the `recommended` flag, which is the opposite of how
  `DEFAULT_BANK` works. The difference is the point: recommending one bank while pre-selecting
  another would be a disagreement, but here the default is a promise that a user who scrolls
  past this section gets exactly what they got before it existed. The recommendation is an
  offer, not a change applied on their behalf.
- **The ₴300 in the copy is interpolated, never written into the dictionary.** It comes from
  `GET /sales/config`, falling back to `DEFAULT_MIN_ORDER_KOPECKS`, because the server
  can be configured differently and the screen is quoting the figure as an offer. It survives
  only inside the two option descriptions — the section had a paragraph explaining *why* the
  floor exists, which was our plumbing described to someone who has no use for it and was
  removed.

## The timeline was formatting USDT as hryvnia

`SaleTimelineEntry` ran every event's `amount` through `formatUah`. Most are fiat, but
`STOPPED_BY_USER` carries the refund in **USDT cents** — and now `REMAINDER_REFUNDED` does too.

It was invisible twice over: that translation happens not to interpolate the figure, and the two
formatters are currently identical arithmetic. Neither is a guarantee. `REMAINDER_REFUNDED` does
interpolate it, and the moment either formatter gains a currency symbol the mislabelling becomes
a number quoted in the wrong unit. `USDT_AMOUNT_EVENTS` names the exceptions.

⬜ The unit belongs on the event, not in a set the client maintains. `SaleEvent.amount`
would be better as a tagged pair, which would also let a refund entry state the hryvnia it was
converted from — the client cannot show that today, because the snapshot carries no rate.

---

## The card was checked on one side only

The server has always refused an order whose card is not the one the drop link pays into —
`ERROR.SALE.CARD_MISMATCH`, before anything is frozen. The create form did not.

It *prefilled* the field when the bank named a card and then forgot the bank's answer, so a user
who typed over it found out at submit — by which point they had left their bank app and had
nothing to copy the right number from. Prefilling is a convenience; keeping what the bank said is
what makes it checkable.

`dropCardNumber` is now held beside `jarGoal` and `dropOwner`, and `cardMismatch` is a `computed`
for the same reason `goalMismatch` is: the field can be edited after the link resolves, and a
verdict taken at paste time would be about a number no longer on screen. It is cleared on the
same three paths they are — a failed resolve, and a bank switch, where a card checked against the
old bank says nothing about the new one.

**It stays quiet until the field holds a whole card.** Sixteen digits arrive one keystroke at a
time, and calling every prefix a mismatch would put an error under the input for the entire time
it is being filled in.

`isSameCardNumber` moved from the backend into `@transacto/contracts`, next to
`isGoalWithinTolerance` and for the same reason: a client that accepted a pair the server refuses
lets a user submit an order rejected the instant it arrives, and one that refused a pair the
server accepts blocks an order that was set up correctly.

⬜ **Only PrivatBank can be checked.** Its envelope record names the card it pays into.
Monobank's jar returns an `iban` but no card number — captured live, not assumed — and the form
asks for a card, so the two are not comparable. PUMB discloses neither. On those two banks the
field is typed unverified, exactly as before, and nothing on screen claims otherwise.

---

## A deploy broke every phone that had the app open

Reported from a real release: the Mini App was open on a phone, a new version went out, and
navigation stopped responding — taps did nothing, then odd behaviour.

Every feature route is lazy, so its bundle is fetched at the first tap, and `outputHashing` names
each bundle after a hash of its contents. A release renames all of them and deletes the old
names, while the open phone still holds the previous deploy's `index.html` and knows only the
names that are gone.

The [Caddyfile](./Caddyfile) then made it far worse than a missing file. `try_files` sent the
request for a deleted bundle to the SPA fallback, so `import()` received **`200 text/html`** — it
failed on parse rather than on a status code — and the `immutable` header, matched on the request
path before the rewrite, told the phone to **cache that HTML under the bundle's URL for a year**.
Every later attempt then failed from cache without a request, which is why the breakage persisted
instead of passing. Verified against a real `caddy:alpine` with this config, not reasoned about.

Two fixes, both needed:

**The fallback no longer answers for bundles.** The cache split is now two `handle` blocks rather
than two `header` lines, because the halves also need opposite answers about a *missing* file: a
hashed bundle 404s, and only the unhashed half serves the shell. A 404 there also carries
`no-store` — a content hash names its contents, so a name that 404s today can legitimately return
in a later deploy that rebuilds the same chunk, and a year-long cached 404 would be the same bug
with the roles reversed.

**The app recovers instead of sitting there.** `withNavigationErrorHandler` routes the failure to
`StaleBundleRecoveryService`, which loads the route the user was reaching for — `index.html` is
`no-cache`, so that lands on the current deploy. Recognising the failure is text matching in
`shared/utils/stale-bundle.util.ts`, since the builder emits native `import()` and the rejection
is a plain `TypeError` worded differently by every engine; the alternative was reloading on every
navigation failure, which would hide genuine bugs behind a refresh.

**At most one reload per session, and none at all when `sessionStorage` cannot be written.** A
WebView reloading in a loop is worse than a dead screen: nothing can be read, nothing navigated,
and inside Telegram it is not easily closed. A storage that cannot record the attempt is also one
that cannot stop the next failure reloading again, so it fails closed. All three guards are
mutation-tested — each was removed in turn and the suite went red.

⬜ **A second deploy inside one session is not recovered.** The marker is never cleared, so the
user reopens the app. Clearing it on the first successful navigation after a reload would fix
that, at the cost of the plumbing to observe one.

⬜ **The reload still costs the user their place.** An in-progress sale form is gone.
Serving the previous deploy's bundles alongside the new ones would avoid the interruption
entirely — the hashes never collide — but the [Dockerfile](./Dockerfile) builds each image from
scratch, so it needs a volume or a copy from the prior image.

---

## The create form counts slots, not hryvnia

The trust-level ceiling on order size is gone from the backend, so it is gone from here: the
`maxSale` signal, the `maxSaleKopecks` conversion, the `isAmountValid` computed and
the ceiling clause in `isValid()` are all deleted, along with `scroll.max_for_level`,
`scroll.limit_exceeded` and `trust_page.max_order` in all three dictionaries.

What replaced it is the parallel-order allowance. `GET /sales/config` now sends
`maxParallelOrders` and `openOrders`, and the form refuses when they meet — before the user has
filled in a link, a card and an amount, rather than on submit. **This is the courtesy, not the
enforcement**: the server checks again under a lock, and its answer is the one that counts.

`slotsExhausted()` is guarded on `maxParallelOrders() > 0`. The signal starts at zero, and reading
that as "no slots left" would grey out the whole form for the instant before the config lands —
on every single load.

The ladder page shows the allowance per rung in place of the old USDT ceiling, so the three levels
still visibly differ from one another.

⬜ **`openOrders` is a snapshot taken when the page loads.** A user who finishes an order in
another tab, or has one blocked while this form is open, sees a stale count until they navigate
away and back. Harmless in the safe direction — the server is the authority and will accept an
order the form thought was impossible only if a slot really is free — but the reverse shows a
usable form that submit then refuses with 1317. Pushing the count over the existing socket would
fix it.

---

## The bank picker offers one bank, and fills in the card itself

Monobank and PUMB are greyed out with a "temporarily unavailable" ribbon rather than hidden: a
picker that silently loses two of its three tiles reads as a broken screen. `pointer-events: none`
stops the tap, but `onSelectBank` refuses a disabled bank as well — that guard, not the CSS, is
what makes the grey mean something.

For a bank in `BANKS_DISCLOSING_CARD` the card field is **read-only**. It was already prefilled
from the link; making it editable only ever added a way to fail, since the server now uses the
bank's answer whatever is submitted. `readonly` rather than `disabled`, so the number can still be
selected and copied.

Three states, because an empty locked field with no explanation is worse than no field at all:
before the link resolves it says the number will be filled in from it; with a card it shows the
green confirmation; and a link that resolved *without* a card says so — that is a dead end the
server refuses, and only the screen can tell the user to fix the link.

`isValid()` now requires the bank to be enabled and, for a disclosing bank, a card that actually
came from the bank. The length check alone would pass on a stale value left behind by a previous
link.

⬜ **The reset in `onSelectBank` is currently unreachable.** Dropping the resolved card, goal and
owner when the bank changes is correct — a verdict about one bank's link says nothing about
another's — but with exactly one bank enabled there is no pair to switch between. It is kept, not
deleted, and comes back into play the moment a second bank is re-enabled. The test covers the
guard instead.

---

## The 10 USDT floor was enforced but never stated

Nothing had removed it. `isValid()` refused an amount under `MIN_USDT_AMOUNT`, the server
answered 1314, and the input even carried `min="10"` — which a phone keypad does not enforce.
What was missing is that **no part of the screen ever named the figure**, so a user who typed 5
got a dead submit button and no reason for it. The `scroll.min_amount` key had been sitting in all
three dictionaries, translated, called by nobody.

It is now a standing row beside the rate and the balance — a fact you can read before typing, not
only a complaint after — plus an explicit message once an amount under it is entered. The message
holds its tongue on an empty field: nothing typed is not a mistake, and an error under an untouched
input greets every user with a complaint.

The floor comes from `MIN_ORDER_USDT`, re-exported from the contract, so the number shown and the
number enforced are one value. Its test asserts the verdict turns over exactly at the contract's
constant rather than at a literal 10, so the two cannot drift.

⬜ **`ERRORS.1314` spells "10 USDT" into all three dictionaries.** `ApiErrorService` selects a
translation by code and passes no interpolation params, so the figure cannot come from the
constant the way the form's message does. Raising the floor would leave three translations lying
until someone edits them.

---

## The Meta Pixel counts screens, not sessions

The tag in `index.html` fires one `PageView` on load. That is the whole of it for a normal site
and almost nothing for this one: the app is a single page, so a user moving between the dashboard,
a deposit and a sale produced no further events and Meta saw one view per *session*.

`MetaPixelService` reports the rest from the router's `NavigationEnd`. Two decisions in it are
worth keeping:

**It decides by URL, not by counting events.** The load is already reported by the tag, and
Angular's initial navigation ends on that same URL — so seeding `lastReported` from the address
bar drops the duplicate. It has to work when the initial navigation is *missed* too, which is a
real timing: a late subscription simply never sees it (`AppComponent.showNav` carries a `startWith`
for the same reason). Comparing URLs gives one view per load under both timings, where counting
"skip the first event" would double-count under one of them. The same comparison drops a
re-navigation to the screen the user is already on.

**It subscribes rather than going through `toSignal`,** which is how this app usually crosses the
RxJS boundary. A signal holds only the latest value, so two navigations settling in one
change-detection pass would collapse into a single reported view. An analytics feed that quietly
loses events is worse than none, because nothing about it looks wrong — a test caught exactly this
and the subscription is the fix, not the test.

A missing `fbq` — an ad blocker, a WebView with no network — is a no-op, and the compiler enforces
the check: removing the guard is a type error, not a runtime one.

### Production only, and what that is worth

The tag no longer sits in `index.html` at all: `MetaPixelService` loads Meta's own loader, and one
configured value — `environment.metaPixelId`, empty outside production — decides whether Facebook
is contacted. That is a stronger guarantee than a check inside a pixel that has already loaded.

The refusal is **stated**, not inferred from `window.fbq` being absent. Something else on the page
could define `fbq` — a second tag, a tag manager — and a pixel we deliberately did not load must
not start reporting through somebody else's. A test caught exactly that.

The `<noscript>` fallback went with the tag. Telegram's WebView always runs scripts and an Angular
app without JavaScript shows nothing anyway, so it never fired for anyone.

### What is reported

Two kinds, deliberately apart in `PixelStandardEvent` and `PixelTapEvent`. Meta's optimiser acts on
what it believes its own names mean, so a standard name is used only where the meaning matches:
`CompleteRegistration` on a first open, `AddPaymentInfo` on a funded deposit, `InitiateCheckout`
when a stake is frozen, `Purchase` when an order reaches its target. Everything else is
`trackCustom`, which says what happened and claims nothing more. Ad delivery is optimised toward
whatever the pixel calls a conversion — a wrong name spends real money chasing the wrong people.

Values are UAH, converted from kopecks **in the service**. A call site passing kopecks straight
through would report ₴4 040 as 404 000, and that number is exactly what bidding runs on.

`[appTrackTap]` is a directive rather than a call in each handler: counting a tap is not the
business of the method acting on it, and a nav anchor has no handler to add one to. `click` alone
covers taps — a browser synthesises it for a touch, so a second touch listener would double every
mobile tap.

⬜ **`Purchase` is client-side, so it needs the app open.** An order that completes while the user
is away is never counted, and there is no retry. It is fired from the same guard as the completion
haptic — one place deciding "this is a change, not the state the page opened on" — so reopening a
finished order does not count it again. Meta's server-side Conversions API is the real fix.

⬜ **No deduplication across sessions.** Nothing carries an `event_id`, so if the Conversions API is
ever added, the two feeds would double-count until one is given one.

## App-wide state moved into NgRx

Four services held the app's shared state in private signals — `TmaSessionService`
(the launch verdict), `UserService` (profile and timeline, held by nobody and
re-fetched per screen), `ExchangeRateService` (the price, with its own TTL) and
`TrustLevelService` (the ladder, loaded once). Each was defensible on its own.
Together they had no single answer to any question two screens both asked, and
the dashboard is where that showed:

```ts
// what the dashboard used to do about its own balance
readonly balance = linkedSignal<{ fetched: number; pushed: number | null }, number>({ … })
```

Three sources fed one number — the session captured at launch, the profile
fetched on entry, the `balance.updated` socket push — and none of them was
reliably the newest, so the component decided per render. It also had to
re-fetch the profile itself when a push arrived, because the push carries only
the available balance while the thing that caused it moved the frozen side too.

The four services are gone. Their state is four slices, each beside the api
service that fills it: `auth/store`, `user/store`, `core/store` (rates) and
`dashboard/store` (the ladder). The reconciliation disappeared rather than
moving — `/auth`, the profile read and the socket push are three actions into
one reducer, and the last write is the state.

What came with it:

- **The socket bridges in as an effect**, `toObservable(ws.balanceUpdated)`, so
  neither side knows about the other. `WsService` still latches events into
  signals, which is what makes an event from earlier in the session apply rather
  than be lost.
- **Derived state became selectors.** `selectTurnoverProgress` spans the user
  and trust slices; it was a `computed` on the dashboard that the levels page
  could not reach, so the levels page did the arithmetic again.
- **The registration pixel fires from an effect** on `authenticateSuccess`
  rather than from the dashboard's `ngOnInit`, which ran on every navigation
  home and counted the same registration each time.
- **No `provideStoreDevtools`.** The store holds a balance and the card numbers
  of payouts being settled; a devtools connection publishes every action to any
  extension installed in a WebView we do not control.

⬜ **Feature state is still local.** Sales, deposits and fiat top-ups
keep their lists and their in-flight forms in component signals. That is
deliberate for the forms and arguable for the lists — the status page and the
dashboard timeline both describe the same orders, and each fetches its own.

## Every price arrives on one poll

`GET /api/tma/exchange-rate` answered with one number, and each screen asked for
it separately: the dashboard through a service with a 60-second TTL, the fiat
top-up screen by reading a field out of its own options response. When a second
rate appeared — the discounted one a hryvnia top-up is credited at — that
pattern would have meant two endpoints polled at two cadences, and two screens
open a minute apart quoting different prices for the same USDT.

It is now `GET /api/tma/rates`, returning both, polled every 30 seconds by one
effect into one slice. The rates are derived together from the one cached market
figure, so the pair is always internally consistent even when it is a minute old.

**A screen that prices something still does not read the slice.** A quote has to
come back with the balance and limits it was computed against, in one response,
or the client can freeze a stake at a price the server never agreed to — so
`/sales/config`, `/deposits/config` and `/fiat-deposits/options` still
carry their own rate and always will.

---

## The onboarding tour

A spotlight walkthrough of the home screen: a full-screen overlay cuts a hole around one
dashboard element at a time — balance, trust card, the two tiles, the activity tabs, the nav —
and a card beside it says what that thing is. `app/onboarding/` holds the step machine, the
persistence and the overlay; the anchors (`[appTourAnchor]`), their registry and the `TourStep`
enum live in `shared/`, because the bottom nav is `shared/` and has to name one.

Three decisions worth not undoing:

- **Only a brand-new account gets it unprompted.** `AuthResponse.isNewUser` is true on exactly
  one `/auth` in an account's life, and `armOnboardingTour` writes `pending` to storage the
  moment it fires — not when the dashboard first shows, because a new user deep-linked to the
  top-up list who closes the app there would otherwise never be owed the tour again. "No stored
  flag" was rejected as a trigger: it also means "storage failed", and would have shown the tour
  to every existing account at release.
- **Visibility is derived, never called.** `OnboardingTourService.active` is "due, and the
  balance card is registered, and neither blocking screen is up". The balance card renders only
  inside the dashboard's loading `@else`, so its registration is the fact that the home screen
  is on and loaded — the tour cannot paint over the spinner or on `/deposit/fiat`, and no page
  has to remember to start it.
- **Writes are chained.** `TmaStorageService.set` awaits the cloud before writing locally, so
  `pending` at `/auth` followed by a quick Skip could land in the wrong order; the service issues
  the second write only once the first has settled, and reconciles the cloud monotonically
  (`null < pending < done`, a user's own action outranking a late read).

⬜ **The page under the tour is not `inert`.** `aria-modal` hides it from screen readers, and
Tab is wrapped inside the card, but on Telegram Desktop a keyboard user can still reach nothing
*and* a VoiceOver swipe on iOS can still explore the dashboard beneath the scrim. Making the
routed view inert needs a wrapper element around `<router-outlet>` and the nav in `app.html`,
which the shell does not have today.

⬜ **`TmaStorageService.set` writes the cloud first and local second.** The tour chains its own
writes so they land in order, but a kill inside the ≤1.5 s cloud window right after "Got it"
still loses the `done` once and the tour reappears on the next open — and a kill inside the
same window right after `/auth` loses the `pending`, which `isNewUser` never writes again.
Reversing the shared service's write order is a decision for every preference at once, not this
feature's.

⬜ **A `startapp=topup` launch can flash the welcome card.** The initial navigation lands on `/`
and `followStartParam` only then goes to `/deposit/fiat`; if the timeline answers before the
lazy deposit chunk activates, the balance card registers for a tick and the tour paints before
the dashboard is torn down. The chunk is cached and immutable, so it wins in practice; gating
`active` on the router having no navigation in flight would close it for good.

⬜ **Nothing pins that every anchor is still on the dashboard.** The anchors register from the
template, so wrapping `.tabs-row` in a condition would silently turn the ACTIVITY step into a
centred card. The dashboard page has no spec (pages are untested throughout); when it gains one,
it should render with a loaded store and assert the registry holds the five dashboard steps.
