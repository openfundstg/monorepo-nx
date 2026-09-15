# Monobank Extension (`apps/monobank-extension`) — Agent Rules

Angular 22 · TypeScript 6 · **Zoneless** · Chrome Extension (MV3) · i18n via `ngx-translate`

Mandatory for all code in `apps/monobank-extension/src/**`.

- **Where a file goes / creating a module, service, guard, pipe** → [.claude/skills/angular-structure/SKILL.md](.claude/skills/angular-structure/SKILL.md)
- **Types shared with the backend** → [../../CONTRACTS.md](../../CONTRACTS.md)
- **What isn't compliant yet** → [REFACTORING.md](./REFACTORING.md) — a backlog, never a precedent to copy

## Build

`npx nx build-extension monobank-extension` is the **only** target that produces a loadable
unpacked extension — it builds the Angular app, then compiles `background.ts` into the same
output directory. Plain `nx build` gives you an app with no service worker, because
`@angular/build` cleans its output directory and would wipe `background.js`.

`background.ts` is loaded by Chrome as a **native ES module**, so every relative import in it
needs an explicit `.js` extension. Without one Chrome fails with
`Failed to resolve module specifier` and the worker silently never runs.

## Shared contracts

Anything crossing the wire — status enums, WebSocket event names and payloads, DTO shapes —
comes from `@transacto/contracts`. Never redeclare one locally:

```ts
import { WsEventNames, OrderStatus, TerminalHistory } from '@transacto/contracts';
```

---

## Banned → Required

| ❌ Never | ✅ Always |
|---|---|
| `@Input()` | `input()` / `input.required()` |
| `@Output()` + `EventEmitter` | `output()` |
| `@Input()`+`@Output()` two-way pair | `model()` |
| `@ViewChild()` / `@ContentChild()` | `viewChild()` / `contentChild()` |
| `*ngIf`, `NgIf` | `@if` / `@else` |
| `*ngFor`, `NgFor` | `@for` — `track` is mandatory |
| `[ngSwitch]`, `NgSwitch` | `@switch` / `@case` / `@default` |
| `NgClass` / `NgStyle` | `[class.x]` / `[style.x]` |
| `NgZone`, `zone.js`, `runOutsideAngular` | nothing — the app is zoneless |
| constructor parameter injection | `inject()` |
| getter deriving from signals | `computed()` |
| `let` | `const` |
| `any` | concrete type or `unknown` |
| string union type | `enum` |
| loose numeric / grouped constants | `const X = { … } as const` |
| inline `template:` / `styles:` | separate `.html` / `.scss` files |
| `standalone: true` | omit it — it's the default in v22 |
| `.push()` / `.splice()` / in-place `.sort()` | spread, `.toSorted()`, `.with()` |

---

## Zoneless

`zone.js` is not a dependency and must never be added. `app.config.ts` provides
`provideZonelessChangeDetection()`. Never inject `NgZone`.

**Change detection runs only when a signal changes.** A plain property will not update the
view — this bites hardest on values arriving from WebSocket messages and `chrome.*` callbacks.

```ts
isLoading = false;                        // ❌ invisible to change detection
readonly isLoading = signal(false);       // ✅
```

---

## Signals

```ts
readonly terminal = input.required<Terminal>();
readonly hasAlert = input(false);
readonly isExpanded = model(false);          // two-way: [(isExpanded)]
readonly toggle = output<void>();

readonly isSyncing = signal(false);
readonly percent = computed(() => {          // ✅ derived state
  const { balance, goal } = this.terminal();
  return goal > 0 ? Math.min((balance / goal) * 100, 100) : 0;
});
```

- Derived state → `computed()`. Never a getter that reads signals; never an `effect()` that
  writes another signal.
- Locally-writable derived state → `linkedSignal()`.
- RxJS boundary → `toSignal()`. Don't `.subscribe()` in a component when `toSignal()` or
  `httpResource()` will do.
- `effect()` is for side effects only — DOM, storage, `chrome.*`.

```html
@if (terminal(); as t) { <span>{{ t.balance | kopecks }}</span> } @else { <app-skeleton /> }

@for (order of orders(); track order.id) { <app-order-row [order]="order" /> }
@empty { <p>{{ 'orders.empty' | translate }}</p> }

@switch (status()) {
  @case (OrderStatus.Pending) { <app-pending /> }
  @default                    { <app-unknown /> }
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
  selector: 'app-terminal-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KopecksPipe, TranslatePipe],
  templateUrl: './terminal-card.component.html',
  styleUrl: './terminal-card.component.scss',
})
export class TerminalCardComponent {
  readonly dashboardService = inject(DashboardService);   // ✅ inject(), readonly
}
```

`imports:` lists only what the template actually uses. `OnPush` on every component.

---

## Functional & Immutable

`const` unless reassignment is genuinely required. `readonly` on every property and injected
dependency that is not reassigned — signal holders included, since the reference never changes.

```ts
const total = orders.reduce((sum, o) => sum + o.amount, 0);   // ✅
let total = 0; for (const o of orders) total += o.amount;     // ❌

this.items.update(items => [...items, next]);                 // ✅ new reference
this.items().push(next);                                      // ❌ mutation
this.user.update(u => ({ ...u, name }));                      // ✅
```

Prefer `readonly T[]` for collections crossing an API boundary. Helpers in `utils/` are pure —
no component state, no `chrome.*`, no network.

---

## Types, Enums, Constants

```ts
type BankProvider = 'MONO' | 'PRIVAT';        // ❌ string union — banned

export enum BankProvider {                    // ✅ enums/bank-provider.enum.ts
  MONO = 'MONO',
  PRIVAT = 'PRIVAT',
  PUMB = 'PUMB',
}

export const PollingInterval = {              // ✅ grouped / numeric constants
  Tick: 1_000,
  StaleAfter: 25_000,
} as const;
export type PollingInterval = typeof PollingInterval[keyof typeof PollingInterval];
```

Compare against enum members (`=== BankProvider.PRIVAT`), never raw strings. Magic numbers and
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
└── app/<module>/{api,components,pages,services,enums,interfaces,constants,
                 guards,resolvers,interceptors,pipes,directives,modals,routes.ts}
```

**The code conforms to this today** — the spec is descriptive, not aspirational. Current modules:

| Folder | Holds |
|---|---|
| `core/` | `SessionService`, `SocketService`, `SocketSyncService`, `apiTokenInterceptor` |
| `shared/` | `KopecksPipe` |
| `auth/` | login page, `authGuard` / `guestGuard`, `AuthService` + `AuthApiService` |
| `layout/` | `MainLayoutComponent`, `HeaderComponent` |
| `dashboard/` | dashboard page, terminal-alerts component, `AlertsService` + api |
| `terminal/` | terminal-card, history page, `TerminalService` (ngrx signal store), `TerminalLoaderService` + api |
| `safe-box/` | safe-box page, `SafeBoxService` + api |

`SessionService` is deliberately separate from `AuthService`: the interceptor needs the token,
and `AuthService` injects `HttpClient` — depending on it would put the interceptor inside its
own dependency cycle.

- `*.api.service.ts` = HTTP call only; `*.service.ts` = all logic and state. Components call
  `*.service.ts`, never `*.api.service.ts`.
- Guards, resolvers and interceptors are **functional** (`CanActivateFn`, `ResolveFn`,
  `HttpInterceptorFn`) using `inject()` — never classes. Routes are lazy, one `routes.ts` per module.
- Every URL, key and tunable lives in `src/environments/*.ts`. Hardcoded URLs, hostnames or
  tokens in source files are forbidden.
- Shared SCSS partials in `src/styles/` — `@use`, never `@import`.
- **i18n is `ngx-translate`.** Strings go in `src/assets/i18n/{en,ru,uk}.json`, used via
  `TranslatePipe` / `TranslateService`. Never hardcode user-facing text in a template. Do not
  introduce `@angular/localize` or `.xlf` files.

**Full file-placement spec, with suffixes and examples → [.claude/skills/angular-structure/SKILL.md](.claude/skills/angular-structure/SKILL.md)**
