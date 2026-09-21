# Admin Panel (`apps/admin`) — Project Rules

Angular 22 · TypeScript 6 · **Zoneless** · Angular Material 22 · NgRx 22 · i18n via `ngx-translate`

Mandatory for all code in `apps/admin/src/**`.

- **Types shared with the backend** → [../../CONTRACTS.md](../../CONTRACTS.md)
- **Backend endpoints and access rules** → [../api/CLAUDE.md](../api/CLAUDE.md)

## What it is

One operator's view of everything: Mini App users and their money, sales,
deposits, referrals, the terminal/scraper pipeline, traders, alerts, the safe box,
support threads, and an audit trail of what admins did.

Served at `https://<domain>/admin`, same origin as the API. **That is not a
convenience** — the session is a cookie and the API deliberately does not send
`Access-Control-Allow-Credentials`, so a cross-origin deployment would arrive
unauthenticated. See the CORS note in `apps/api/src/main.ts`.

## Build & run

```bash
npx nx serve admin          # dev server, proxies /api and /socket.io to :8000
npx nx build admin          # production (baseHref /admin/, hashed bundles)
npx nx typecheck admin
npx nx test admin           # vitest
npx nx lint admin
```

## The three rules that shape everything here

### 1. Every write delegates to the service that already owns it

Cancelling a sale, blocking one, standing a terminal down — the backend's
admin services call `SaleCancelService`, `SaleBlockService`,
`TerminalDeactivationService`. Those paths unfreeze stakes, retire terminals
upstream, pay referrers and push progress to the user's own screen. **A second
implementation would be a second settlement path for the same money.**

The one exception is a manual balance correction, which has no product
equivalent — and is therefore the most heavily audited thing in the system.

### 2. Every action carries a reason, and every action is audited

The reason field is required by the DTO, not decorated onto it. It is written to
`admin_audit_logs` and is never shown to the user it concerns, which is precisely
why it can be candid. `AdminAuditService.record` is the only writer; there is no
update or delete path, because an audit trail the actor can edit answers nothing.

### 3. The database stores keys; this client renders the sentence

Statuses, alert types and audit actions are enum members. The panel builds
`'AUDIT.' + action`, `'SALE_STATUS.' + status`, `'errors.' + code` by
concatenation — those key names appear nowhere in the source, so
**`src/app/shared/i18n.spec.ts` is the only thing that catches a missing one.**
Add an enum member to a contract and that spec goes red until its copy exists.

API failures carry `{ code, message }` from `ERROR`. Switch on `code`; `message`
is developer-facing English and must never reach a screen.

---

## Banned → Required

| ❌ Never                                   | ✅ Always                                 |
| ------------------------------------------ | ----------------------------------------- |
| `@Input()`                                 | `input()` / `input.required()`            |
| `@Output()` + `EventEmitter`               | `output()`                                |
| `@ViewChild()`                             | `viewChild()`                             |
| `*ngIf`, `*ngFor`, `[ngSwitch]`            | `@if` / `@for` (with `track`) / `@switch` |
| `NgClass` / `NgStyle`                      | `[class.x]` / `[style.x]`                 |
| `NgZone`, `zone.js`                        | nothing — the app is zoneless             |
| constructor parameter injection            | `inject()`                                |
| getter deriving from signals               | `computed()`                              |
| `let`                                      | `const`                                   |
| `any`                                      | concrete type or `unknown`                |
| string union type                          | `enum`                                    |
| inline `template:` / `styles:`             | separate `.html` / `.scss` files          |
| `standalone: true`                         | omit it — the v22 default                 |
| `.push()` / in-place `.sort()`             | spread, `.toSorted()`, `.with()`          |
| a raw hex or `rgba()` in a component style | a `var(--…)` from `styles/_tokens.scss`   |
| hardcoded user-facing text                 | a translation key                         |

---

## Structure

```
src/app/
├── core/          app-wide singletons: AdminHttpService, AdminSocketService,
│                  SocketLifecycleService, the two interceptors, adminGuard
├── shell/         the frame — nav, topbar, live indicator
├── auth/          login page, auth store, session restore
├── shared/        components · pipes · utils · enums · interfaces · store
└── <feature>/     overview · users · sales · deposits · documents ·
    ├── constants/   fiat-deposit-watches · referrals · terminals · orders ·
    ├── pages/       traders · alerts · safe-box · support · audit
    ├── services/  <name>.api.service.ts (HTTP only) · <name>.service.ts (logic)
    ├── store/     <name>.collection.ts — the slice, its actions and its effects
    └── routes.ts  lazy, with provideState + provideEffects
```

Components call `*.service.ts` or dispatch, never `*.api.service.ts` directly.
Guards and interceptors are functional. Routes are lazy, one `routes.ts` per feature.

### Where state lives, and where it does not

**In NgRx** — anything shared, live-patched or worth keeping across navigation:
every list. All of them are one implementation, `createCollection` +
`createCollectionEffects` in `shared/store`. A list is a name, a default sort, an
optional default chip and an `idOf`; it is never a fresh
actions/reducer/selectors trio.

**`idOf` is `kind:id`, not `id`, on the two merged books.** The deposits list
spans `tma_deposits` and `tma_fiat_deposits` and the archive spans sale
statements and fiat receipts; each collection mints its own ObjectIds and
nothing stops one from matching another. An identity of `id` alone would let one
rail's live push overwrite the other's row — rarely, unreproducibly, and about
somebody's money.

**Not in NgRx** — the overview and the three detail pages (a user, a sale, a
deposit). One reader each, no live stream, thrown away on close. They use
`rxResource` in a plain service. Four files to hold a value with one reader is
ceremony, not architecture.

### The terminal history is not the generic table

`/terminals/:cardId/history` renders `@transacto/history-table` — literally the same component
the Chrome extension uses, extracted into `libs/history-table` when the panel needed it too.
Two copies would be two implementations of the same six columns and the same badge rules, and
"identical" would survive exactly until the first change to either.

The library is **presentational**: it takes `logs` and renders them. Each app loads its own
rows over its own socket — the extension for its trader, the panel for anybody — because none
of that belongs in a table. The panel's endpoint therefore returns the **whole stored record**,
not a projection: the table reads `executionReason` to pick an order badge, and a narrower
shape silently downgraded every matched order to the generic badge.

It renders keys and ships no dictionary, so `HISTORY.*` and `ALERTS.*_DESC` live in this app's
own `uk.json` — copied from the extension rather than reworded, and pinned by `i18n.spec.ts`.

### One book, cut by chips — not a screen per collection

Four sidebar entries became two, and the split that went was ours rather than
the product's. A user tops up with USDT or with hryvnia and thinks of neither as
a separate feature — and the rule that matters most about them treats the two as
one, since a new account's ₴2 000 ceiling lifts on **one settled deposit by
either method**. A screen per rail cannot explain why somebody's ceiling lifted.

The same for sales on a jar and sales to a card, and for the dispute queue,
which was a screen of its own: an operator arriving from Transacto's panel with
an order number could find the dispute and nothing around it — not the seller,
not the stake, not the terminal. It is now `AdminSaleFilter.DISPUTED`, and the
sales search box takes a card order's number alongside a sale's public code.

So: **where two lists answer one question about one person, they are one list
with a `filter`.** The chip lives in `CollectionState.filter`, travels as
`AdminPageReq.filter`, and is validated on the backend against that list's own
enum — `AdminSalesPageQueryDto` and friends, never a bare string.

Two consequences in the generic table. A mixed list carries **two status enums in
one column**, so `translatePrefix` may be a function of the row
(`depositStatusPrefix`, `documentStatusPrefix`); flattening them into a third
enum would be a status written down in three places and agreeing in two. And the
money must be **one unit per column on every row** — the deposits feed converts
whole USDT to cents in its own aggregation pipeline, because a row carrying
whichever unit its source used is a hundredfold error no type catches.

### Rows link to each other; they do not print ids to copy

`shared/utils/links.util.ts` is the one home for every link one screen makes to
another, and `ColumnType.ROUTER_LINK` / `ColumnType.REFS` are how a column
carries one. Before them an operator followed an id by selecting it, opening
another screen and pasting it into a search box — which is why nobody did, and
why a question spanning two entities took four navigations.

Every link carries `search` or `filter` as a **query parameter**, and every list
applies them through `bindListQuery`. A link that merely opened a list would be
a link to a haystack with a note about which needle. Absent parameters change
nothing, so a list keeps its state when an operator navigates away and back.

**A list opens with `bindListQuery` and never with a bare `entered()`.** The two
are not alternatives: `bindListQuery` sends `entered` itself, and only when the
URL asked for nothing. This shipped wrong — links were built to ten lists that
still opened themselves with `entered()`, so `/admin/orders?search=30323` listed
every order on every card. Nothing threw, nothing failed, and the only symptom
was a destination showing everything. `shared/list-query.spec.ts` now reads the
source of every page that renders `app-collection-table` and fails on either
mistake, because no type can express "this component read its query string".

**A number is not an address until something says which book it counts in.**
Transacto numbers its **orders** and its **payouts** separately: a card order a
sale answers for and a payout a hryvnia top-up settles are different entities
that both count from one, and `/orders` lists only the first. Three links here
fed a `payoutId` into it anyway — a deposit row, a receipt row and the deposit
page — and each answered with an empty list or, where the numberings happened
to overlap, with somebody else's order presented as this row's. A payout is
therefore shown as **plain text**, because the panel has no payouts screen and
the errand is carrying the number across to Transacto's own panel by hand. The
same collision is why `documentsForLink` takes a kind: the archive searches
both numberings, so a deposit promising "2 documents" must ask for receipts or
its count and its destination disagree.

### Colour says identity; `ChipTone` says how worried to be

`ChipTone` has four members and that is the point — a palette with a colour per status is one
where two screens disagree about whether `BLOCKED` is amber or red. So a **bank** and a **sale
method** do not go through it: neither is good or bad news, and a fifth tone meaning
"PrivatBank" would make the vocabulary mean nothing. They go through `badge.util.ts`, which is
the same discipline (`Record<Enum, string>`, no fallback) over a separate axis, and a chip may
wear a tone and a badge at once. Rows are tinted by bank through the table's `rowClass`, far
weaker than the badge: a row is a band of colour several hundred pixels wide.

### One filter mechanism, and the units convert at its edge

`CollectionState.filters` is a `Record<string, string>` — the archive's one chip and the two
books' seven fields are the same mechanism, and `bindListQuery` puts every query parameter that
is not `search` into it, so a link can narrow a list by anything the destination's DTO accepts.

`BookFiltersComponent` is one component because it mirrors one contract: `AdminBookFilters` is
the same shape for both books, which is why the backend builds both with one
`bookFilterClauses`. Only the enumerations differ, and those are inputs.

**It converts at the edge and nowhere else.** A person types hryvnia and USDT; the wire carries
kopecks and cents, as it does everywhere. A form that sent what was typed would filter "sales
over ₴5 000" as "sales over ₴50" — not an error anywhere, just a plausible-looking list that is
wrong by a hundred, on the screen used to answer questions about money. It also **drops
empties**, because the backend refuses an empty filter and a filter matching nothing is exactly
what that refusal prevents.

What an operator last narrowed a list to is remembered in `localStorage` per list, through
`FilterStorageService` — a working preference, not shared state, and every read and write is
guarded because a private window makes the accessor throw.

### A sale's timeline, and whose word each entry stands on

`/sales/:id` renders `app-sale-timeline`, which is **not** the jar history's shape and must not
become it. A jar row is an observation; a card row is an assertion plus whatever later
corroborated it. `evidence` is therefore a column rather than a detail, and an entry whose
evidence is `SELLER` with no `corroboratedBy` is drawn as what it is — a claim nobody has
checked. `evidence: null` is every entry written before this was recorded, and is shown as
unknown rather than guessed. See the card-sale note in the root `CLAUDE.md` for the rule itself.

### Documents are shown, and their bytes are ours to serve

`/documents` lists every file this product holds — statements and receipts
together, each row naming the sale or the top-up it is about. The bytes come
from `GET /api/admin/documents/:kind/:id/file`, **inline by default** so a glance
is a glance, with `?disposition=attachment` for filing one against an appeal.

A row whose retention has passed keeps its record and loses its buttons:
`fileAvailable` is `false`, and the screen says the file is gone rather than
offering a download that 404s. "We never kept this" and "we no longer keep this"
are different answers to give somebody asking about their own money.

### The generic table

Every list renders through `shared/components/collection-table`, driven by
`ColumnDef[]`. **Pass it `[rowId]`** — the collection's own `idOf`, which the
`CollectionApi` exposes for exactly this. It used to track rows by the *first
column's value*, on a comment claiming that column was always an id; it was an
id on three lists out of thirteen, and the rest lead with `createdAt`, a
terminal name or a person's display name. Two rows sharing one tracked as one
row, and a live push then updated whichever of them the differ happened to pair
it with.

`ColumnDef[]` continues: A column names its key, its header, its `ColumnType` and a `value`
function returning the **raw** figure — never a formatted string. `ColumnType` is
what decides formatting, and it is the single `switch` that keeps UAH kopecks,
USDT cents and whole USDT from being rendered as one another. That confusion is a
hundredfold error no type catches, since all three are `number`.

### Realtime

`AdminSocketService` holds one socket on the `/admin` namespace, authenticated by
the session cookie at handshake — there is no token to pass, and none to leak.
Each feature has one effect mapping a socket event to its own `upserted` action;
`core/` never imports a feature.

A pushed row **replaces** one on screen. A row that is not on screen is _counted_,
not inserted — where it belongs under this search, this sort, on this page is a
question only the server can answer, and inventing an answer puts the row in the
wrong place and shifts every row after it. The count surfaces as a "N new rows"
bar offering a refresh.

The socket opens on login and closes on logout. It must close: the admin room
carries every user's traffic.

---

## Styling

Two SCSS partials, both pulled in by `styles.scss`:

- **`styles/_tokens.scss`** — the palette and shape vocabulary as CSS custom
  properties. One dark palette, deliberately; there is no light variant to keep
  in step. A colour in a component stylesheet must be a `var(--…)`.
- **`styles/_primitives.scss`** — `.card`, `.chip` + its four tone classes,
  `.mono`, `.numeric`, `.scroll-x`, `.page-title`.

Status colours come from `ChipTone`, and `shared/utils/tone.util.ts` is the only
place a status is mapped to one. The maps are `Record<Enum, ChipTone>` with no
fallback on purpose: a new status fails to compile until somebody decides what it
means.

Wide tables scroll inside `.scroll-x`. The page body must never scroll sideways —
that takes the navigation off screen with it.

---

## Gotchas

- **Angular versions are pinned exactly** in `package.json`, not ranged. Two
  copies of `@angular/core` in one workspace means two distinct `InjectionToken`
  types, and Material's own DI tokens then fail to type-match — which is what a
  floating `^22.1.1` produced here, resolving this app to a newer patch than the
  other apps and nesting a second copy under `apps/admin/node_modules`.
- **`baseHref` is `/admin/`**, set on the build target. The container's Caddyfile
  strips the prefix with `handle_path`; the two have to agree or every bundle
  404s into the SPA fallback.
- **No `provideAnimationsAsync()`.** Material 22 animates with CSS and does not
  need `@angular/animations`; providing it pulls the package in for nothing.
- **`MAT_DIALOG_DATA` is read in two steps** — see the note in
  `reason-dialog.component.ts`. A type assertion directly on the `inject()` call
  supplies a contextual type that breaks the token's own inference.
- **Prettier**: this project and `libs/contracts` use `semi: true` +
  `trailingComma: "all"`, declared as an override in the root `.prettierrc`. The
  root defaults describe `apps/api`.
