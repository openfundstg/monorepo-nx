# Telegram Mini App (`apps/telegram-mini-app`) — Agent Rules

Angular 22 · TypeScript 6 · **Zoneless** · Telegram Mini App · i18n via `ngx-translate`

Mandatory for all code in `apps/telegram-mini-app/src/**`.

- **Where a file goes / creating a module, service, guard, pipe** → [.claude/skills/angular-structure/SKILL.md](.claude/skills/angular-structure/SKILL.md)
- **Types shared with the backend** → [../../CONTRACTS.md](../../CONTRACTS.md)
- **What isn't compliant yet** → [REFACTORING.md](./REFACTORING.md) — a backlog, never a precedent to copy

## Build

`npx nx build telegram-mini-app` (defaults to the production configuration) and
`npx nx serve telegram-mini-app` for the dev server, which proxies `/api` and `/socket.io` to
`127.0.0.1:8000` via `proxy.conf.json` and allows ngrok hosts.

## Nothing renders before Telegram is verified

`tmaGuard` sits on the parent of every route. It dispatches `authActions.authenticate()`
if nobody has yet, then waits for the `auth` slice to leave `SessionState.PENDING`
— the effect exchanges the launch's `initData` for a profile at `POST /auth`, so
the verdict is the **server's**, not "is there a string in `initData`". A visitor
without a signed launch is sent to `/unavailable`, a bare "open in Telegram"
screen carrying no product surface at all.

**The guard is what asks**, not an app initializer. Effects are subscribed when
the injector builds them, which is after initializers run, so a dispatch that
early fires into nothing. Several guards resolve at once on a deep link and each
will dispatch; `exhaustMap` in the effect is what turns that into one request.

The app shipped without this. Nothing guarded a route, so a stranger with the
URL got the whole dashboard — empty, because every request behind it answered
`401`, but complete.

**It is not a security boundary.** The bundle is downloadable and the check runs
in the client. What actually stops data leaving is `TmaAuthService` on the
backend, verifying Telegram's HMAC on every request — and it is the only thing
that could, because `initData` arrives in the URL _fragment_, which browsers
never send to a server. A static SPA cannot be gated server-side.

**`TmaService.init()` runs as an app initializer**, not in `AppComponent`. The
router's first navigation happens before any component's `ngOnInit`, so a
handshake there left the guard reading an empty `initData` and bouncing every
real user to the gate. Anything the guard or `tmaAuthInterceptor` needs must be
in place before bootstrap finishes.

## Shared contracts

Anything crossing the wire — `TmaUser`, `TrustLevel`, deposit and sale statuses,
realtime event payloads — comes from `@transacto/contracts`. Never redeclare one locally:

```ts
import { TmaUser, TrustLevel, TmaDepositStatus } from '@transacto/contracts'
```

`app/core/models/` no longer exists; those types now live in the contracts library.

---

## Banned → Required

| ❌ Never                                     | ✅ Always                         |
| -------------------------------------------- | --------------------------------- |
| `@Input()`                                   | `input()` / `input.required()`    |
| `@Output()` + `EventEmitter`                 | `output()`                        |
| `@Input()`+`@Output()` two-way pair          | `model()`                         |
| `@ViewChild()` / `@ContentChild()`           | `viewChild()` / `contentChild()`  |
| `*ngIf`, `NgIf`                              | `@if` / `@else`                   |
| `*ngFor`, `NgFor`                            | `@for` — `track` is mandatory     |
| `[ngSwitch]`, `NgSwitch`                     | `@switch` / `@case` / `@default`  |
| `NgClass` / `NgStyle`                        | `[class.x]` / `[style.x]`         |
| `NgZone`, `zone.js`, `runOutsideAngular`     | nothing — the app is zoneless     |
| constructor parameter injection              | `inject()`                        |
| getter deriving from signals                 | `computed()`                      |
| `let`                                        | `const`                           |
| `any`                                        | concrete type or `unknown`        |
| string union type                            | `enum`                            |
| loose numeric / grouped constants            | `const X = { … } as const`        |
| inline `template:` / `styles:`               | separate `.html` / `.scss` files  |
| `standalone: true`                           | omit it — it's the default in v22 |
| `.push()` / `.splice()` / in-place `.sort()` | spread, `.toSorted()`, `.with()`  |

---

## Zoneless

`zone.js` is not a dependency and must never be added. `app.config.ts` provides
`provideZonelessChangeDetection()`. Never inject `NgZone`.

**Change detection runs only when a signal changes.** A plain property will not update the
view — this bites hardest on values arriving from Telegram WebApp callbacks and WebSocket messages.

```ts
isLoading = false;                        // ❌ invisible to change detection
readonly isLoading = signal(false);       // ✅
```

---

## App-wide state is NgRx; screen-local state is signals

Four slices, and the rule for which is which is whether the value outlives the
screen reading it:

| Slice | Where | Holds |
| --- | --- | --- |
| `auth` | `auth/store/` | the launch verdict and the `/auth` session |
| `user` | `user/store/` | profile, balance, frozen balance, turnover, level, timeline |
| `rates` | `core/store/` | the market rate and the discounted hryvnia top-up rate |
| `trust` | `dashboard/store/` | the trust ladder |

`auth`, `user` and `rates` are registered at the root in `app.config.ts`; `trust`
comes with `provideState` on the two routes that read it. There is **no
`provideStoreDevtools`** — this store holds a user's balance and the card numbers
of the payouts they are settling, and a devtools connection publishes every
action to whatever extension the client happens to have installed.

Three things this bought that are worth not undoing:

- **One answer about the balance.** Three sources move it — the launch session,
  a profile refetch, the `balance.updated` socket push — and the dashboard used
  to run a `linkedSignal` deciding on every render which of them was newer. The
  socket bridges into the store through `toObservable(ws.balanceUpdated)` in
  `user.effects.ts`, and the last write is simply the state.
- **One rate, on one timer.** `rates.effects.ts` polls `GET /api/tma/rates`
  every 30 s and every screen that merely *shows* a price reads the slice.
  A screen that **prices** something still takes its rate from the response that
  carried the amounts — `/sales/config`, `/deposits/config`,
  `/fiat-deposits/options` — or the quote and the amount can disagree.
  The poll may still be its *trigger*: the sale forms read the slice only to
  learn that the market moved, then re-read `/sales/config` in the background
  (`SalePricingService`) and say what changed (`SaleRateNoticeComponent`).
  They used to read the rate once, and the server re-priced a stale quote in
  silence — ten USDT typed became a 9.98 sale. Now `POST /tma/sales` refuses
  any `quotedRate` but the live one, so the figures on the form are the sale.
  **A typed amount is sold to the cent** (`priceStake`): the stake is the
  figure typed and the total is its price rounded to the nearest hryvnia, never
  the other way round. Only a total held at a jar's goal derives its stake
  (`priceSale`). The form sends both, and the server refuses a pair that is not
  one price (`ERROR.SALE.QUOTE_MISMATCH`) rather than repricing it.
- **Derived state in selectors.** `selectTurnoverProgress` spans the `user` and
  `trust` slices; it is not a `computed` in the dashboard, because the levels
  page needs the same arithmetic.

Feature-local state — a form's fields, an upload in flight, which amount is
awaiting confirmation — stays in component signals. Full placement rules are in
the [angular-structure skill](.claude/skills/angular-structure/SKILL.md#the-store).

## Signals

```ts
readonly userId = input.required<string>();
readonly showFees = input(false);
readonly activeTab = model(HistoryTab.ALL);      // two-way: [(activeTab)]
readonly refresh = output<void>();

readonly balance = signal(0);
readonly formattedBalance = computed(() => formatUsdt(this.balance()));   // ✅ derived state
```

- Derived state → `computed()`. Never a getter that reads signals; never an `effect()` that
  writes another signal.
- Locally-writable derived state → `linkedSignal()`.
- RxJS boundary → `toSignal()`. Don't `.subscribe()` in a component when `toSignal()` or
  `httpResource()` will do.
- `effect()` is for side effects only — DOM, storage, Telegram WebApp SDK calls.

<!-- prettier-ignore -->
```html
@if (user(); as u) { <span>{{ u.balance | usdt }}</span> } @else { <app-skeleton /> }

@for (item of filteredHistory(); track item.id) { <app-activity-row [item]="item" /> }
@empty { <p>{{ 'dashboard.empty_history' | translate }}</p> }

@switch (activeTab()) {
  @case (HistoryTab.DEPOSITS) { <app-deposits /> }
  @default                    { <app-history /> }
}
```

> `track` is required on every `@for`. Use a stable id — `track $index` only for primitive
> lists that are never reordered.

---

## Components

Every component is **three files** — `.ts` + `.html` + `.scss`. No inline template or styles,
ever. Everything is standalone: never `standalone: false`, never declared in an `NgModule`
(there are none). Don't write `standalone: true` — it's the v22 default.

```ts
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, UahPipe, UsdtPipe, DateTimePipe, BottomNavComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  private readonly userService = inject(UserService) // ✅ inject(), readonly
}
```

`imports:` lists only what the template actually uses. `OnPush` on every component.

---

## Functional & Immutable

`const` unless reassignment is genuinely required. `readonly` on every property and injected
dependency that is not reassigned — signal holders included, since the reference never changes.

```ts
const total = operations.reduce((sum, op) => sum + op.amount, 0) // ✅
let total = 0
for (const op of operations) total += op.amount // ❌

this.items.update((items) => [...items, next]) // ✅ new reference
this.items().push(next) // ❌ mutation
this.user.update((u) => ({ ...u, name })) // ✅
```

Prefer `readonly T[]` for collections crossing an API boundary. Helpers in `utils/` are pure —
no component state, no Telegram SDK, no network.

---

## Types, Enums, Constants

```ts
type HistoryTab = 'history' | 'deposits' // ❌ string union — banned

export enum HistoryTab {
  // ✅ shared/enums/history-tab.enum.ts
  ALL = 'history',
  DEPOSITS = 'deposits',
  SALES = 'sales'
}

export const TurnoverThreshold = {
  // ✅ grouped / numeric constants
  EXPERIENCED: 10_000_000, //    dashboard/enums/turnover-threshold.enum.ts
  PRO: 50_000_000
} as const
export type TurnoverThreshold = (typeof TurnoverThreshold)[keyof typeof TurnoverThreshold]
```

Compare against enum members (`=== HistoryTab.DEPOSITS`), never raw strings. Magic numbers and
magic strings in components or services are forbidden. `strict: true`, no `any`, explicit
return types on public methods, interfaces PascalCase with **no `I` prefix**.

---

## DRY & SOLID

**DRY** — no logic twice. Repeated markup → a component; repeated logic → a service method, a
pure `utils/` function, or a pipe. Search `services/`, `utils/`, `pipes/` before writing a helper.

**SOLID** — components render and delegate; business logic lives in `*.service.ts` and HTTP in
`*.api.service.ts` (a component holding `HttpClient` is wrong). Extend through new inputs and
DI tokens rather than growing an `if`/`switch`. Keep interfaces small. Depend on injected
abstractions — never `new` a service, never reach into another component's internals.

---

## Structure & i18n

```
src/
├── index.html · styles.scss · styles/ · fonts/ · assets/i18n/ · environments/
└── app/<module>/{api,components,pages,services,store,enums,interfaces,constants,
                 guards,resolvers,interceptors,pipes,directives,modals,routes.ts}
```

**The code conforms to this today** — the spec is descriptive, not aspirational. Current modules:

| Folder                                                    | Holds                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/`                                                   | `TmaService` (Telegram SDK), `tmaAuthInterceptor`, `AuthApiService`, `tmaGuard`, and the `auth` store slice                                                                                                                                                             |
| `core/`                                                   | the one app-wide thing no feature owns: `RatesApiService` and the `rates` store slice                                                                                                                                                                                    |
| `shared/`                                                 | `components/bottom-nav`, `pipes/` (`uah`, `usdt`, `dateTime`), `directives/` (`appTrackTap`, `appTourAnchor`), `utils/format.util.ts`, `enums/` (`HistoryTab`, `AppLanguage` + `APP_LANGUAGES`), `constants/language.const.ts`, `services/` (`ApiErrorService`, `LanguageService`, `TmaStorageService`), `i18n.spec.ts` |
| `realtime/`                                               | `WsService`                                                                                                                                                                                                                                                             |
| `user/`                                                   | `UserApiService` (profile, balance history) and the `user` store slice                                                                                                                                                                                                  |
| `onboarding/`                                             | the tour's step machine, persistence and overlay; its anchors, registry and `TourStep` live in `shared/` because the bottom nav names one                                                                                                                              |
| `dashboard/` · `deposit/` · `sale/` · `settings/` | their routed pages, plus the services, enums and constants only that feature uses                                                                                                                                                                                       |

`shared/` is the app's only cross-module home. The formatters live there twice on purpose:
`utils/format.util.ts` for `.ts` callers and the three pipes for templates, the pipes delegating
to the utils. Never re-declare a `formatUah` in a component — that duplication is what let the
dashboard and the old wallet page disagree about kopecks versus cents.

`<app-bottom-nav />` is rendered **once by `AppComponent`**, never by a page. It used to sit in
each page's template, which meant every navigation destroyed and rebuilt it — visible as a
flicker on each tap. The shell shows it for routes carrying `data: { nav: true }` (dashboard,
referral, settings) and hides it on sub-flows like deposit and sale, which have their
own back button.

It is fixed to the viewport, so those three pages must still reserve the space with
`padding-bottom: calc(80px + var(--app-safe-bottom, 0px))` on `:host` — the variable covers the
gesture bar underneath it in fullscreen mode.

**A stale client is forced to reload, not asked to.** `AppVersionService` reads the entry
bundle's name out of the live `index.html` — `main-KJBQSQ6Q.js`, whose hash is the content's own
— records it at start-up, and re-reads it every minute and on every return to the foreground. A
different name means a different release, and `UpdateRequiredComponent` paints over everything
with one button that reloads. Nothing is generated at build time and no version constant is
maintained: a number somebody has to remember to bump is a number that eventually is not
bumped.

It works only because of the caching split the `Caddyfile` already draws — `index.html` is
`no-cache` while the hashed bundles are `immutable` — so asking again reaches the origin. Adding
anything to the build that keeps a stable name across deploys must stay on the `no-cache` side,
for this reason as well as the original one.

**Fullscreen launch mode overlays Telegram's own controls on the app.** `TmaService` reads
`safeAreaInset` + `contentSafeAreaInset` (Bot API 8.0+) and `AppComponent` publishes them as
`--app-safe-top` / `--app-safe-bottom`; `app.scss` pads the shell by the top one so no page
title ends up under the back button. Never re-measure this per page — the shell owns it.

`core/` holds exactly one thing: the `rates` slice and the api service that fills it. Everything
else that once lived there was split per module, and nothing may go back in without being
genuinely app-wide **and** owned by no feature — a slice belongs beside the api service that
fills it, not in `core/` because it is important.

- `*.api.service.ts` = HTTP call only; `*.service.ts` = all logic and state. Components call
  `*.service.ts`, never `*.api.service.ts`.
- Guards, resolvers and interceptors are **functional** (`CanActivateFn`, `ResolveFn`,
  `HttpInterceptorFn`) using `inject()` — never classes. Routes are lazy, one `routes.ts` per module.
- Every URL, key and tunable lives in `src/environments/*.ts`. Hardcoded URLs, hostnames or
  tokens in source files are forbidden.
- Shared SCSS partials in `src/styles/` — `@use`, never `@import`. There are two,
  both pulled in by `styles.scss`:
  - **`_tokens.scss`** is the palette and the shape vocabulary, as CSS custom properties.
    **A colour, radius or transition in a component stylesheet must be a `var(--…)`** —
    a raw hex or `rgba()` there is the duplication that let six cards disagree about
    which grey they were. Add a token rather than a literal. The app draws one dark
    palette and deliberately ignores Telegram's `themeParams`; there is no light variant
    to keep in step.
  - **`_primitives.scss`** holds the shapes every screen draws — `.glass-card`,
    `.page-title`, `.primary-btn`, `.spinner`, the badges. Global styles reach into
    components, so these are defined once; a component that needs a variant overrides
    the class locally, which wins because its stylesheet is injected later.
- **i18n is `ngx-translate`.** Strings go in `src/assets/i18n/{en,ru,uk}.json`, used via
  `TranslatePipe` / `TranslateService`. Never hardcode user-facing text in a template. Do not
  introduce `@angular/localize` or `.xlf` files.
- **The dictionaries have a drift guard**: `app/shared/i18n.spec.ts` fails
  `nx test telegram-mini-app` if the three files stop agreeing on their key set, if a value is
  blank, or if a `{{placeholder}}` is present
  in one language and missing from another. It also pins the keys the settings and sale
  status pages build by concatenation (`'status.' + status.toLowerCase()`,
  `'SALE_EVENT.' + event.type`) — those names appear nowhere else in the source, so a grep
  before deleting a key will not find them. Add a key to all three files, or the spec is red.
- The chosen language is persisted by `LanguageService` through `TmaStorageService`
  (Telegram CloudStorage, falling back to `localStorage`) and a stored choice outranks
  Telegram's `language_code` on every subsequent open.

**Full file-placement spec, with suffixes and examples → [.claude/skills/angular-structure/SKILL.md](.claude/skills/angular-structure/SKILL.md)**
