# Shared Contracts — `@transacto/contracts`

One source of truth for everything that crosses the wire between the backend and the two
frontends. Lives at `libs/contracts/` in the monorepo and is imported by all three apps.

**The problem it solved:** every wire contract used to be hand-copied. `WsEventNames`,
`OrderStatus`, `TerminalHistory`, `TmaUser` and friends were declared independently in the
backend and again in each frontend, so a backend rename compiled cleanly everywhere and failed
at runtime. Nothing checked that `'terminal.balance_updated'` in the extension still matched
the gateway emitting it.

**Status — in place and verified.** Renaming a member of `WsEventNames` now fails the extension
build with `TS2551: Property 'TERMINAL_BALANCE_UPDATED' does not exist on type 'typeof
WsEventNames'`. That class of drift bug is closed at compile time.

---

## What goes in

- **Enums** whose values travel over the wire — `OrderStatus`, `OrderExecutionReason`,
  `TerminalHistoryAlertType`, `BankProvider`, `TransactoOrderStatus`, `TerminalType`,
  `Currency`, `UserType`, `TrustLevel`, deposit and sale statuses.
- **WebSocket contracts** — the `WsEventNames` enum plus one payload interface per event.
- **HTTP request/response shapes** — the `*.req.ts` / `*.res.ts` interfaces each endpoint
  exchanges.
- **Shared domain interfaces** — `TerminalHistory`, `Order`, `TmaUser`, `TrustLevelInfo`.
- **Error codes** — the `ERROR` constant, so a frontend can switch on `code` instead of
  matching message strings.

## What stays out

- Anything importing `@angular/*`, `@nestjs/*`, `mongoose`, `rxjs`, or `socket.io`. This
  package is **plain TypeScript** — it must compile standalone with no framework present.
- Mongoose schemas. A schema is persistence, not a contract; it stays in
  `apps/api/src/modules/repositories/**`.
- Validation decorators. `class-validator` stays on the backend DTO **class**, which
  `implements` the shared interface.
- UI state, component logic, i18n strings, anything app-specific.

---

## How each side uses it

**Backend** — the DTO class implements the shared interface, keeping validation where it
belongs while the shape stays governed centrally. Responses are typed by the contract
interface directly; there is no separate response DTO class, and no Swagger in this workspace:

```typescript
import { CreateDepositReq } from '@transacto/contracts'

export class CreateDepositReqDto implements CreateDepositReq {
  @IsNumber()
  readonly amount: number
}
```

**Frontends** — import the type directly; delete the local copy:

```typescript
import { OrderStatus, WsEventNames } from '@transacto/contracts'
```

**Gateways and clients share the event names**, so a rename breaks the build on both sides
instead of silently at runtime:

```typescript
@SubscribeMessage(WsEventNames.TERMINAL_BALANCE_UPDATED)   // backend
this.socket.on(WsEventNames.TERMINAL_BALANCE_UPDATED, …)   // frontend
```

---

## Migration inventory

| Source                                                          | Contains                                                                                    | Status                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `monobank-extension/core/models/ws-contracts.ts`                | `WsEventNames`, `OrderStatus`, `OrderExecutionReason`, `TerminalHistory*`, 7 event DTOs     | ✅ moved; file deleted                                                                                                              |
| `monobank-extension/core/models/order.model.ts`                 | duplicate `OrderStatus`/`OrderExecutionReason`, `Order`                                     | ✅ deleted — it was imported by nothing                                                                                             |
| `telegram-mini-app/core/models/user.model.ts`                   | `TmaUser`, `TrustLevelName` string union, `AuthResponse`, `UserProfileResponse`             | ✅ moved; union → `TrustLevel` enum                                                                                                 |
| `telegram-mini-app/core/models/{deposit,sale}.model.ts` | status enums + shapes                                                                       | ✅ moved; `core/models/` deleted                                                                                                    |
| `telegram-mini-app/core/services/ws.service.ts`                 | `DepositStatusEvent`, `SaleStatusEvent`, `BalanceUpdateEvent` inline                 | ✅ moved; re-exported for existing consumers                                                                                        |
| `api/src/shared/constants/bank.constants.ts`                    | `BankProvider`, `BANK_URL_KEYWORDS`                                                         | ✅ moved; file is now a re-export bridge                                                                                            |
| `api/src/shared/constants/tma.constants.ts`                     | `TrustLevelName` derived union                                                              | ✅ replaced by `TrustLevel`; thresholds stay backend-side                                                                           |
| `api/src/modules/telegram-mini-app/schemas/tma-*.schema.ts`     | `TmaDepositStatus`, `TmaSaleStatus`                                                  | ✅ re-export from contracts                                                                                                         |
| `api/src/shared/interfaces/order.interface.ts`                  | `TransactoOrderStatus`, `TerminalType`, `Currency`, `TransactoOrder`, `OrderWebhookPayload` | ⬜ **pending** — these describe the upstream Transacto API, decide whether they are a wire contract for our frontends before moving |
| `api/src/shared/constants/errors.ts`                            | `ERROR`                                                                                     | ✅ created in contracts (it never existed backend-side); 45 throw sites migrated, and both frontends now switch on `code`           |

**Re-export bridge pattern.** Where many backend files already import a type through a local
barrel, the local file becomes a one-line re-export rather than churning every call site:

```typescript
// api/src/shared/constants/bank.constants.ts
export { BankProvider, BANK_URL_KEYWORDS } from '@transacto/contracts'
```

That keeps one definition while leaving the 8 existing importers untouched. It is a bridge, not
a licence to redeclare.

---

## What the admin panel added

The panel is a third consumer, and it moved two things here that were previously
backend-only:

- **`SupportTopicStatus` and `SupportLocale`** (`enums/support.enum.ts`). They lived in
  `api/src/shared/constants/support.constants.ts` on the stated grounds that "no browser or
  Mini App ever sees a support topic". The panel does — it lists threads and the people behind
  them — so both crossed the wire and moved. The backend keeps a one-line re-export bridge, and
  `SupportTopicTitleState` deliberately stayed behind: it records what was last written into a
  Telegram title so a rename happens exactly on a change, which is a fact about our conversation
  with Telegram rather than about the thread.
- **`SaleBlockReason.ADMIN_DECISION`.** The only member no rule produces — the other two
  are conclusions the pipeline reaches on its own. A user whose order an operator stopped by hand
  has to be told that, rather than shown a rule they did not break. Adding it required its copy
  in all three Mini App dictionaries, which the drift-guard spec enforces.

Everything else the panel needs is new and lives in `enums/admin.enum.ts`,
`interfaces/admin.interface.ts`, `ws/admin-events.enum.ts` and the `ERROR.ADMIN` block
(2300). Note what is _not_ there: no `apiToken` on `AdminTraderListItem`. That token
authenticates the extension as its trader, so a panel that listed it would turn read access
into full impersonation — it is dropped by the query projection, not merely left unmapped.

## Layout

```
libs/contracts/
├── package.json                 # name: @transacto/contracts
├── tsconfig.json
└── src/
    ├── index.ts                 # barrel — the only public entry point
    └── lib/
        ├── enums/               # order-status · bank-provider · alert · tma · admin · support · fiat-deposit
        ├── interfaces/          # order · tma · alert · terminal · terminal-history · referral · admin · fiat-deposit
        ├── ws/                  # ws-events · tma-events · admin-events · terminal-events.contract
        └── constants/           # errors · money · public-id · referral · card-number ·
                                 #   bank-capabilities · sale-quote · fiat-receipt · fiat-deposit
```

Consumers import from the package root only (`@transacto/contracts`), never a deep path.

**`constants/` holds shared *arithmetic*, not only values.** Anything both sides compute — what a
target costs (`priceSale`), what hryvnia buy (`usdtCentsForKopecks`), what a top-up is
discounted to (`buyRate`) — belongs here for the same reason a shape does: two
implementations of one calculation is two answers to a question about somebody's money, and the
place they meet is a screen showing both. Each of those carries a doc comment saying which
direction it rounds and why; that is part of the contract, not a note.

**Relative imports inside this package need explicit `.js` extensions** — `module: nodenext`
resolves them the way Node does, so `from './lib/enums/alert.enum.js'` is correct even though
the file on disk is `.ts`. Omitting it fails the build.

## Rules

1. A type used by more than one app **must** live here. Duplicating it in an app is a review
   rejection.
2. This package never imports from an app. Dependencies point inward only.
3. No framework imports — it must build with plain `tsc`.
4. Because everything is one repo, a contract change and both consumers land in the **same
   commit**. There is no version to bump; if a rename breaks a consumer, the build fails
   immediately, which is the point.
5. Enum members follow the backend convention (SCREAMING_SNAKE_CASE) since the backend owns
   these values and they travel as strings.
