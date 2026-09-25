# Transacto Backend (`apps/api`) — Project Rules

NestJS backend inside the Nx monorepo. These rules apply to all code in `apps/api/src/**`.

Detailed examples live in on-demand files, not here:

- Adding an HTTP endpoint → `.claude/skills/create-endpoint/SKILL.md`
- Reviewing code → `.claude/agents/strict-reviewer.md` (9 anti-patterns, with ✅/❌ examples)
- Wire contracts shared with the frontends → [../../CONTRACTS.md](../../CONTRACTS.md)
- What isn't compliant yet → [REFACTORING.md](./REFACTORING.md) — a backlog, never a precedent to copy

---

## Stack

| Category | Technology | Version |
|---|---|---|
| Runtime | Node.js | ≥20 |
| Framework | NestJS | 11.x |
| HTTP Adapter | Express (`@nestjs/platform-express`) | 5.x |
| Database | MongoDB (Mongoose) | 9.x |
| Cache / Queue | Redis (ioredis) + BullMQ | — |
| Validation | class-validator + class-transformer | — |
| Build | Nx + webpack (`nx build api`) — **transpile-only, run `nx typecheck api` too** | — |

**Global invariants:**

- **Mongoose `strict: true` silently drops update keys the schema does not declare.**
  It is the default, and it applies to `$set` and `$unset` alike — so an update meant to
  *remove* a field the schema no longer declares does nothing, reports `modifiedCount: 1`
  for whatever else it changed, and leaves the document matching the filter that found it.
  A migration written that way ran eleven thousand times against production and drove every
  sale's exchange rate to 1e97. Any write that touches a path not on the schema —
  which is every write that removes one — must pass `{ strict: false }` explicitly, and say
  why. `strictQuery` is off by default, so *finding* such documents works and only the
  writing fails, which is what makes it silent.

- Mongoose: global `MongooseLeanVirtual` plugin — every query returns a plain JS object, never a Mongoose document.
- Guard execution order is fixed: `CsrfGuard` → `UserTypesGuard` → `DemoReadOnlyGuard`, all
  registered as `APP_GUARD` in `app.module.ts`. There is no session guard — every caller
  authenticates with an explicit header, so `UserTypesGuard` resolves the credential itself.
  `DemoReadOnlyGuard` comes last because it needs to know who is asking: it refuses every
  `POST`/`PUT`/`PATCH`/`DELETE` a **demo account** sends (`ERROR.TMA_DEMO.READ_ONLY`) unless the
  handler carries `@DemoAllowed()` — which only the launch and the jar-link read do. Refusing is
  the default so a write added later is covered without anybody remembering to.
- The `src/*` alias resolves through `tsconfig.app.json` `paths` **and** a matching
  `resolve.alias` in `webpack.config.js`. Webpack does not read app-level tsconfig paths, so
  both must be kept in step. (`baseUrl` is deprecated in TypeScript 6 — do not reintroduce it.)

- **ValidationPipe is global** — registered via `APP_PIPE` in `app.module.ts` with
  `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. Consequences worth
  knowing: a request DTO property with **no** `class-validator` decorator is silently stripped,
  and any unexpected property in a payload is a `400`. Both make decorating every DTO field
  mandatory rather than cosmetic.

- **File uploads work, but their types do not.** `FileInterceptor` comes from
  `@nestjs/platform-express` and multer is present as its dependency, so multipart endpoints run
  — but **`@types/multer` is not installed**, so `Express.Multer.File` does not exist. Declare
  the three fields you read (`buffer`, `originalname`, `mimetype`) as a local interface rather
  than adding a types package for one parameter; `tma-fiat-deposit.controller.ts` shows it. Put
  the size limit on the interceptor *and* in the service: the first stops a phone streaming ten
  megabytes into memory, the second holds for every caller.

> ⚠️ **Not configured today**, despite being inherited from another codebase's rules: Throttler
> defaults and `@Throttle()`, the 10 MB body limit (only `rawBody: true` is set, so Express's
> 100kb JSON default applies), the global `MongooseLeanVirtual` plugin, and session-cookie HMAC
> auth. The plain-object invariant above is upheld by explicit `.lean()` calls, not a plugin.
> Tracked in [REFACTORING.md](./REFACTORING.md).

**Access control decorators** — every endpoint carries exactly one access decorator. They live in
`src/modules/auth`; `UserTypesGuard` reads them on every HTTP route.

| Decorator | Meaning |
|---|---|
| `@UserTypeTrader()` | Authenticated trader only — requires a valid `x-api-token` |
| `@UserTypeTMA()` | Authenticated Telegram Mini App user only — requires valid `x-tma-init-data` |
| `@UserTypes(...)` | Explicit list when more than one type may call the endpoint (any one may) |
| `@Public()` | No authentication |
| `@SkipCsrf()` | Skip CSRF — webhooks and OAuth callbacks; combine with `@Public()` when unauthenticated |

- **Access is denied by default.** A handler with no access decorator throws
  `ERROR.CONFIG.MISSING_ACCESS_DECORATOR` (500) and logs its name. Forgetting the decorator
  cannot publish an endpoint.
- Adding a new authentication scheme means adding a `UserType` member plus a
  `UserTypeAuthenticator` in `auth/services/` — never a new per-module guard.
- `CsrfGuard` only enforces when a `csrf-token` cookie is present, which is never today: header
  credentials cannot be forged cross-site. It is in place so introducing cookie auth does not
  require retrofitting CSRF onto live endpoints.
- WebSocket handlers bypass both guards by design — gateways authenticate once at handshake.

---

## Strict Layer Principle

Every feature follows exactly this chain — no skipping, no merging layers:

```
Controller → Service ─┬→ DB Service        (src/modules/repositories/**)
                      └→ API Service       (third-party HTTP)
```

| Layer | Responsibility | File suffix | Lives in |
|---|---|---|---|
| **Controller** | Accept HTTP request, delegate to Service, return DTO | `.controller.ts` | `modules/{domain}/` |
| **Service** | Business logic, orchestration between services | `.service.ts` | `modules/{domain}/services/` |
| **API Service** | Dumb third-party HTTP calls — no business logic | `.api.service.ts` | `modules/{domain}/services/` |
| **DB Service** | Mongoose queries only — no business logic | `-db.service.ts` | `modules/repositories/{domain}-db/services/` |
| **Schema** | Mongoose schema definition | `.schema.ts` | `modules/repositories/{domain}-db/schemas/` |
| **Guard** | Authentication & authorization | `.guard.ts` | `modules/{domain}/guards/` |
| **DTO** | Input validation on the request shape | `.req.dto.ts` | `modules/{domain}/dto/` |

**Absolute rule — the database layer is isolated.** Mongoose (schemas, `Model`, `this.*Model.*`, `find()`, `aggregate()`, `@InjectModel`) exists **only** under `src/modules/repositories/**`. A domain module never imports `mongoose` or `@nestjs/mongoose`, never defines a schema, and never runs a query.

- A domain service reads and writes by injecting the matching `{domain}-db.service.ts`.
- Controllers hold no business logic and never inject a DB service — they call the domain service only.
- `.api.service.ts` is transport only: build the request, return the response. Every decision belongs in `.service.ts`.

### Money has one door

Every write that moves a Mini App user's **spendable balance** goes through
`BalanceLedgerService` (`modules/telegram-mini-app/services/`), which moves the money and
then appends a row to `tma_balance_entries` saying why. `TmaUserDbService.creditBalance`,
`freezeBalance`, `unfreezeBalance`, `transferReferralToBalance` and `adjustBalance` are its
internals — calling one directly writes a number nothing explains.

That is the state this collection was built to end: the balance used to move in eight places
and only three of them left a document behind, so a referral transfer, an operator's
correction and a sale's stake changed somebody's money and appeared on no screen and
in no record.

Three things about it are worth knowing before adding a movement:

- **The book covers the spendable balance and nothing else.** Committing a frozen stake moves
  only `frozenBalance`; crediting a referrer moves `referralBalance`. Neither is booked, and
  booking either would break the one property the collection has: the sum of a user's entries
  equals their `balance`.
- **The money wins.** The two writes are not in a transaction, so the movement goes first and a
  failure to book is logged and swallowed. A movement with no entry is recoverable from the
  document it came from; an entry with no movement is a lie about somebody's money.
- **`once: true` is a claim, not a default.** It becomes the entry's dedupe key and a unique
  index refuses the second one, so pass it only where a repeat would be the same movement
  arriving twice (a reconciler re-crediting a completed deposit) — never where a user may
  legitimately receive two, as with refunds, transfers and corrections.

### Money that arrived, and money we say arrived

A sale carries two records of the same hryvnia. `receivedAmount` sums
the orders that were credited; the terminal's **baseline** in Redis tracks what
the jar was actually observed to hold. They advance together because both move
only when money is accounted for — so a disagreement is never a rounding
difference, it is something counted twice.

On 2026-09-08 that cost a user 606 UAH of USDT, and every link in the chain
looked reasonable on its own:

1. The jar page lagged, orders neared their deadline, and an operator confirmed
   two of them in Transacto's panel.
2. `order.paid` removed them from the pending pool **and moved nothing else**,
   so their 611 UAH stayed outside the baseline.
3. The page caught up in one jump of 919 UAH. No subset of the orders still
   pending equalled it, because the two that would have were no longer pending.
4. Fuzzy matching found `{308, 300, 306} = 914`, within tolerance of 919, and
   `executeOrder`'d all three — spending the same money a second time.
5. The `UNRECOGNIZED_DEPOSIT` alert raised at step 3 was auto-resolved 35
   seconds later by the fuzzy branch that caused the loss.
6. The order closed on 2480 UAH against a jar holding 1874. Both numbers were in
   the same document.

Three rules came out of it, and all three are now enforced in code:

- **Anything that settles an order outside the matcher must account for its
  money.** `OrderPollingService.handleOrderPaid` advances the baseline by the
  tracked amount, and only on the branch that actually settled it —
  `markCompleted` returning `false` means the matcher got there first and has
  already set the baseline to the balance it read.
- **A completion is refused when `receivedAmount` exceeds the baseline** by more
  than a hryvnia (`SaleBlockReason.LEDGER_MISMATCH`). The stake stays
  frozen for a person to look at, which is what blocking is for. It fails *open*
  when the baseline cannot be read: an unreadable baseline is not evidence, and
  stranding every stake on a Redis restart would be the worse mistake.
- **`FUZZY_MATCHING_ENABLED` is off, and the default in `.env.example` is
  `false`.** It exists for underpayments a fee shaved; what it did here was turn
  an unexplained deposit into two executed orders. An unmatched deposit is a
  question for a human, and the alert was already asking it.

### `order.paid` is usually this process hearing itself

Transacto fires an `order.paid` webhook the instant `orders_execute` succeeds,
so **most deliveries are the echo of a call this API just made** — measured
under a second, and routinely arriving before the matcher has finished writing
its own reason. Read as an operator's manual confirmation it did three things
wrong at once, and all three were visible to users:

- every automatic match was stored as `ADMIN_PANEL` and rendered as
  "confirmed manually";
- the jar baseline was advanced for money that had not landed yet, pushing the
  expected balance ₴1 052 above the real one — the negative "blind spot" on the
  terminal history;
- the webhook path wrote **one history row per order** where the matcher
  batches a whole match into one, because `markCompleted` had already returned
  `false` by the time the matcher got there.

So every path that calls `orders_execute` first calls
`OrderDbService.markExecutionStarted`, and `handleOrderPaid` treats a marker
younger than two minutes as our own echo and returns — leaving the order to the
path that executed it. A *stale* marker is deliberately not an echo: an order
this process failed to execute keeps it, and an operator confirming that same
order later is a genuine manual confirmation whose money still has to be
accounted for.

**Adding a fifth place that executes an order means marking it too.** The
consequence of forgetting is not an error; it is a user being told a machine
decision was a human one.

### Data migrations

Anything the data needs that a deploy cannot do on its own — a collection filled
from what other collections know, a field derived onto documents written before it
existed — is a migration in `src/migrations/scripts/`, not a script somebody runs by
hand once and deletes.

Adding one:

1. `src/migrations/scripts/000N-what-it-does.migration.ts` — an `@Injectable()`
   implementing `Migration`: a `name` (the file's own, and never changed afterwards), an
   `up()` returning one line describing what it did, and a `down()` where undoing is
   genuinely possible.
2. Append it to `MIGRATION_CLASSES` in `src/migrations/migrations.const.ts`. **Append
   only** — the array is the order they run in.
3. Add the repository module it reads through to `MigrationsModule` if it is not there.
   A migration goes through the same DB services the product does; it never touches
   Mongoose itself, and needing a query nobody has needed before means adding it to that
   collection's `-db` service, where the next reader will find it.

Write every migration to survive running twice — the record is written after the work,
so a run that dies leaves it pending. Dedupe keys, `upsert`, or a filter that skips what
is done: pick one, do not skip it.

Running them: `npx nx db-migrate api -- status|up|down` locally,
`./deploy/migrate.sh up` on the server. See [../../deploy/README.md](../../deploy/README.md).

---

## Dependency Injection

- Constructor injection only — field injection (`@InjectModel` on a property) is forbidden.
- All dependencies declared `private readonly`.
- Non-class providers injected via `@Inject(CONSTANT_TOKEN)`, e.g. `@Inject(REDIS_CLIENT)`.
- Global guards / filters / interceptors are registered **only** via `APP_GUARD` / `APP_FILTER` / `APP_INTERCEPTOR` in `AppModule.providers` — never `app.useGlobalGuards()` in `main.ts`, which has no DI container. Use `useExisting` if the class is also listed individually in `providers`, otherwise `useClass`.

---

## Typing

- `strict: true`, `strictNullChecks: true`.
- `noImplicitAny: false` does **not** license `any`. Use a concrete type or `unknown`. `any` is permitted only in `catch (error: any)` and explicitly untyped external API responses.
- All public controller/service methods have explicitly typed parameters and return types. I/O methods return `Promise<T>`.
- Generics on DB methods: `findManyActive<T = ProductDocument>(filter: FilterQuery<Product>): Promise<T[]>`.
- `Types.ObjectId` is the type for every MongoDB identifier.
- `@Type(() => NestedDto)` is mandatory for nested DTOs.

---

## Functional Programming & Immutability

- **`const` over `let`.** `let` only where reassignment is genuinely required — with `map` / `filter` / `reduce` that is rare.
- **`readonly` on everything that doesn't change** — class properties, injected dependencies (`private readonly`), DTO fields, tokens. Prefer `readonly T[]` for collections crossing a service boundary.
- **Pure functions.** Same input → same output, no side effects. Helpers in `*.util.ts` must not touch Mongoose, Redis, or request state.
- **Never mutate** inputs, DTOs, or query results — return new objects and arrays.

```typescript
// ❌
let total = 0
for (const item of cart) total += item.price
items.push(next)
dto.cart.sort((a, b) => a.price - b.price)

// ✅
const total = cart.reduce((sum, item) => sum + item.price, 0)
const updated = [...items, next]
const sorted = dto.cart.toSorted((a, b) => a.price - b.price)
```

---

## Types, Enums & Constants

String union types are forbidden — use an `enum`:

```typescript
// ❌
type UserType = 'BUYER' | 'ADMIN'

// ✅  src/modules/{domain}/enums/user-type.enum.ts
export enum UserType {
  BUYER = 'BUYER',
  ADMIN = 'ADMIN'
}
```

Compare against enum members, never raw strings — `if (user.type === UserType.ADMIN)`.

Numeric values and grouped constants use the const assertion pattern:

```typescript
export const OrderLimit = {
  MAX_CART_ITEMS: 50,
  LOCK_TTL_MS: 10_000,
  IDEMPOTENCY_TTL_S: 600
} as const
export type OrderLimit = typeof OrderLimit[keyof typeof OrderLimit]
```

Magic numbers and magic strings in controllers, services, or guards are forbidden: they belong in an `as const` group or an enum.

### Never store or send user-facing text

**The database stores keys and data. Clients render the sentence.**

A rendered message in a document is frozen in whichever language wrote it, and the usual
"fix" — a copy of the document per locale — is worse: it multiplies rows, and every write has
to keep the copies in step. Neither is acceptable here.

So an event, alert, or status is persisted as:

- **a key** — the enum member that classifies it (`AlertType`, `TerminalHistoryAlertType`), and
- **data** — a typed metadata object holding every value the sentence interpolates.

```ts
// ✗ frozen in English, and combinationsCount exists nowhere else
message: `Ambiguous deposit of ${delta} kopecks. Found ${count} possible combinations.`

// ✓ the client renders ALERTS.AMBIGUOUS_DEPOSIT_DESC in the trader's language
type: AlertType.AMBIGUOUS_DEPOSIT,
metadata: { amount: delta, combinationsCount: count }
```

Consequences worth stating:

- **Every interpolated value must be in the metadata.** A number that only appears inside a
  rendered string is unreachable to the client — the translation will interpolate a blank.
  The per-type shapes live in `AlertMetadataMap` in `@transacto/contracts`, so backend and
  frontend cannot drift.
- **Translation keys equal enum members**, so the client builds them by concatenation
  (`'ALERTS.' + type + '_DESC'`) instead of maintaining a type → key `switch`.
- **English sentences in `logger.*` are fine and encouraged.** Logs are read by operators, not
  traders; only what reaches a user needs translating.
- Amounts stay in kopecks on the wire. Formatting is the client's job.

**Where a type lives depends on whether it crosses the wire:**

| Scope | Home |
|---|---|
| Sent to or received from a frontend (DTO shape, status enum, WS event, error code) | **`@transacto/contracts`** — see [../../CONTRACTS.md](../../CONTRACTS.md) |
| Used by several backend domains | `src/shared/constants/` or `src/shared/interfaces/`, via `index.ts` |
| Used by one domain | `src/modules/{domain}/enums/*.enum.ts` / `interfaces/` |

Never redeclare a contract type locally — that is the duplication the monorepo exists to remove, and `@nx/enforce-module-boundaries` plus review will reject it. A DTO class `implements` the shared interface so `class-validator` stays on the backend:

```typescript
import { CreateDepositReq } from '@transacto/contracts'

export class CreateDepositReqDto implements CreateDepositReq {
  /** USDT cents. Documented in a comment — there is no Swagger here. */
  @IsNumber()
  readonly amount: number
}
```

> **`@nestjs/swagger` is not installed and no source file imports it.** There is no OpenAPI
> document to generate, so `@ApiProperty` and friends do not exist: a DTO documents itself with
> doc comments, and adding a decorator from that package fails the build.

Where a shared enum also has backend-only companions — `TrustLevel` (contracts) versus its turnover thresholds in `TRUST_LEVELS` (backend) — keep the name in contracts and the business rule here. `src/shared/constants/bank.constants.ts` and `tma.constants.ts` show the re-export pattern for keeping existing importers working.

---

## Third-party APIs: describe the whole contract, or ask where to find it

An `.api.service.ts` talks to somebody else's system. Their payload is not ours to shape, cannot
be redeployed when we get it wrong, and changes without telling us. So the interface describing
it carries a different obligation from every other type in this repo.

**Declare every field the API sends and every field it accepts — not the subset the code
happens to read today.**

An interface listing only what a caller currently uses looks complete and is indistinguishable
from one that is simply wrong. It also hides what is on offer:

- Monobank's jar record declared `amount` and `goal` with an `[key: string]: unknown` over the
  rest. `ownerName` was arriving on **every scrape** and nothing in the codebase knew it existed,
  so terminals were created naming the wrong receiver for want of a field we already had.
- Three Transacto list responses were typed `{ status: string }`. The API answers
  `{ success: true, … }`. Nothing broke only because every call site reached straight past the
  envelope — which is exactly what the type was supposed to catch.
- `fetchPrivatBalance` ended `return response.data ? response.data : response`, on a comment
  about responses that "arrive already unwrapped". None does. It type-checked because an
  `AxiosResponse` also has a `.data`, so the wrong object lined up by coincidence.

### Where the contract comes from

In order of preference:

1. **A specification the provider publishes** — an OpenAPI document, a schema, written docs.
   Transacto's `openapi.yaml` is the reason `transacto.interface.ts` can claim to be complete.
2. **A live call.** Every shape in `bank-api.interface.ts` was captured by calling the real
   endpoint against a real jar, envelope or moneybox, and printing keys and types. The banks
   publish nothing, so this is the only honest source.
3. **The rendered page**, when a provider publishes no data at all. NovaPay's "Кейс" is
   the one of these: the case page carries its whole state in a `window.__NOVA_DATA__`
   literal, and the receiving card appears in no field of it — only inside the Ukrainian
   sentence the page renders for sharing. Both are declared on `NovaPayCaseData` with the
   capture's date, and both are parsed strictly: a page without the state and a sentence
   without sixteen digits are refusals, never defaults. Treat a contract like this the way
   the Transacto panel's is treated — a markup change is silent, so whatever reads it must
   say so loudly rather than quietly returning nothing.
4. **Nothing** — in which case say so *in the type*. `PumbRawResponse` keeps its index signature
   and a comment stating the fields are unverified. That is what an unverified contract should
   look like; quietly declaring three fields and stopping is not.

**If you are not confident the interface is right, ask the user where the contracts come from
before writing it.** A guessed interface is worse than an admitted gap: the gap gets fixed, the
guess gets trusted. Ask for the spec, a sample payload, a page in their cabinet, or permission
to call the endpoint — whichever they have.

### Practicalities

- **Capture shapes, never values.** These payloads carry card numbers and IBANs. Print keys and
  types; mask anything that looks like a credential. `PrivatEnvelopeInfo.card`, `.iban` and
  `PrivatZipLinkPayload.to` are full payment credentials and must never reach a log line.
- **A genuinely irrelevant sub-tree may stay opaque, but must be named.** PrivatBank's session
  init returns `data.uiConfig`: several hundred fields of banners, tariffs and FAQ copy in three
  languages, none of which describes an envelope. It is declared as
  `Record<string, unknown>` with a comment saying what it is and why nothing reads it —
  deliberately opaque, which is not the same as undeclared.
- **Note the units and the encodings in the doc comment.** Monobank reports kopecks, PrivatBank
  decimal strings, PUMB an offset from a large negative constant. The same field can differ
  between two endpoints of the same bank: Monobank's `currency` is `"980"` on the jar handshake
  and `980` on the jar record.
- **Contract and adapter are separate files.** The raw shapes live in `shared/interfaces/`; the
  functions turning them into our own types live in `shared/utils/*.util.ts`. Mixing them is how
  a wire shape ends up defined next to the arithmetic that consumes it and grows to fit.
- **These types are not ours to tidy.** Fields stay snake_case if that is how they arrive, and a
  field is optional exactly when the provider says it may be absent — never because it reads
  better. Renaming or narrowing compiles and is then wrong at runtime.

---

## DRY & SOLID

**DRY** — the same logic must not exist twice. A repeated query shape becomes one DB service method, a repeated business rule one service method, repeated validation a pipe or decorator. Search `src/shared/**` and the domain's `services/` before adding a helper.

**SOLID** — controllers accept and delegate, services decide, DB services query; one reason to change per class. Extend with a new service method, provider, or strategy rather than growing an `if`/`switch` in an existing one. Anything injected behind a token must be substitutable without the caller special-casing it. Keep DTOs and interfaces small and focused. Depend on injected abstractions — never `new` a service, never inject a DB service into a controller.

---

## Module Structure

### 1. Domain modules — business logic & API

Routing, validation and business logic. **Never touch Mongoose.**

```
src/modules/{domain}/
├── {domain}.module.ts
├── {domain}.controller.ts
├── dto/
│   └── {action}.req.dto.ts        # requests only — responses are typed from contracts
├── enums/
├── guards/
├── interfaces/              # optional — business-level interfaces
└── services/
    ├── {domain}.service.ts       # business logic
    └── {domain}.api.service.ts   # dumb third-party API calls
```

### 2. Repository modules — the database layer

The **only** place Mongoose schemas and DB services are defined. One `-db` module per domain.

```
src/modules/repositories/
├── {domain}-db/
│   ├── {domain}-db.module.ts
│   ├── interfaces/
│   │   ├── {domain}.interface.ts
│   │   └── index.ts
│   ├── schemas/
│   │   └── {domain}.schema.ts
│   └── services/
│       ├── {domain}-db.service.ts
│       └── index.ts
│
├── interfaces/              # shared database-level interfaces
├── schemas/                 # shared schemas (e.g. counter.schema.ts)
└── services/                # shared database services / global exports
    └── index.ts
```

**Rules:**

1. A domain service injects the matching `{domain}-db.service.ts` for every read and write.
2. Every `interfaces/` and `services/` folder inside a `{domain}-db` module **must** have an `index.ts` barrel. Import through the barrel, never a deep file path.
3. `{domain}-db.module.ts` registers its schemas with `MongooseModule.forFeature()` and exports its DB services; the domain module imports that `-db` module.
4. A domain owning several collections keeps one `-db` module with multiple `schemas/` and `services/` entries, all re-exported from the barrels.

Env variables are added **only** through `src/environments/index.ts`, typed and documented. Hardcoded URLs, hostnames, tokens, secrets, ports, or connection strings in source files are forbidden — reference them via `environments.*`. Shared helpers, constants and Redis wiring live in `src/shared/**`.

---

## Naming

- **Files:** kebab-case with the suffix from the layer table above. Also `.schema.ts`, `.interface.ts`, `.interceptor.ts`, `.filter.ts`, `.pipe.ts`, `.decorator.ts`, `.enum.ts`, `.util.ts`.
- **Barrels:** `index.ts` — mandatory in every `interfaces/` and `services/` folder under `repositories/`.
- **Classes:** PascalCase — `AuthService`, `SignUpReqDto`, `AllExceptionsFilter`.
- **Interfaces:** PascalCase, **no `I` prefix** — `User`, not `IUser`.
- **Enums:** PascalCase name, SCREAMING_SNAKE_CASE members — `UserType.BUYER`.
- **Constants:** SCREAMING_SNAKE_CASE — `SESSION_COOKIE`, `REDIS_CLIENT`.
- **Methods:** camelCase verb-noun — `findById()`, `isValidApiKey()`, `processPayment()`.

---

## Imports — `src/*` alias only

Relative paths deeper than one level are forbidden. Use the `src/*` alias and barrel `index.ts` re-exports.

```typescript
// ✅  import { ensure } from 'src/shared/utils'
// ✅  import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
// ❌  import { ensure } from '../../../shared/utils/ensure.util'
```

### `src/shared/**` never imports from `src/modules/**`

The dependency points one way: modules use `shared`, `shared` knows nothing about them. It is
not enforced by a lint rule — it is upheld by every file in there — and it is what keeps
`shared` importable from anywhere without dragging a domain, a schema or Mongoose behind it.

The rule bites in a predictable place: a helper that maps a **stored document** to a wire shape
looks like a util and is not one, because it has to name the document's type. Those live in
`src/modules/{domain}/utils/` — `telegram-mini-app/utils/fiat-deposit.util.ts` is the example.
What stays in `src/shared/utils/` is arithmetic and parsing over plain values: kopecks, card
numbers, panel timestamps.

### Test helpers

| What | Where |
|---|---|
| Generic testing infrastructure, domain-free | `src/shared/testing/` — e.g. `module-wiring.ts` |
| Fixtures naming one domain's own types | `src/modules/{domain}/testing/`, behind an `index.ts` |

A fixture is a builder with sensible defaults and an `overrides` argument — see
`modules/telegram-mini-app/testing/fiat-deposit.fixture.ts`. Write one the moment a second spec
needs the same object: four copies of the same twenty-five-line document is how two specs end up
disagreeing about what a record looks like, and one of them starts passing for the wrong reason.

Fixtures are **not** `.spec.ts` files — Jest would collect them as suites with no tests — so they
are ordinary modules that nothing in the app imports.

---

## Errors

Throw NestJS HTTP exceptions carrying an `ERROR` constant — never `new Error()`, a custom error class, or a plain string message.

```typescript
throw new NotFoundException(ERROR.USER.NOT_FOUND)          // ✅
throw new NotFoundException('User not found')              // ❌ no ERROR code
```

New error domains go in `libs/contracts/src/lib/constants/errors.ts`, numbered in increments of 100. `ERROR` is owned by `@transacto/contracts` so both frontends can switch on `code` instead of matching message strings.

> ⚠️ `ERROR` does not exist in the codebase yet — every current `throw` uses a plain string. Creating it is tracked in [REFACTORING.md](./REFACTORING.md); until it exists, follow this rule for new code by adding the codes you need.

---

## Code Style

**Omit braces for single-line `if` bodies.**

**Prefer the `ensure` helper over `if (!x) throw`:**

```typescript
// ✅
const alert = ensure(
  await this.alertsService.acknowledgeAlert(alertId, traderId),
  new BadRequestException(ERROR.ALERT.NOT_FOUND)
)

// ❌
const alert = await this.alertsService.acknowledgeAlert(alertId, traderId)
if (!alert) throw new BadRequestException(ERROR.ALERT.NOT_FOUND)
```

---

## Async / Concurrency

Independent async operations run in parallel via `Promise.all()` with destructuring — never sequential `await`s when the calls don't depend on each other.

Redis locks always release in `finally`:

```typescript
const acquired = await this.redis.set(lockKey, '1', 'PX', 10000, 'NX')
if (!acquired) throw new ConflictException(ERROR.ORDER.DUPLICATE_REQUEST)

try {
  return await this.processOrder(dto)
} finally {
  await this.redis.del(lockKey)
}
```
