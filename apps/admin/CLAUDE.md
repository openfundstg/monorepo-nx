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
└── <feature>/     overview · users · sales · deposits · referrals ·
    ├── constants/   terminals · orders · traders · alerts · safe-box ·
    ├── pages/       support · audit
    ├── services/  <name>.api.service.ts (HTTP only) · <name>.service.ts (logic)
    ├── store/     <name>.collection.ts — the slice, its actions and its effects
    └── routes.ts  lazy, with provideState + provideEffects
```

Components call `*.service.ts` or dispatch, never `*.api.service.ts` directly.
Guards and interceptors are functional. Routes are lazy, one `routes.ts` per feature.

### Where state lives, and where it does not

**In NgRx** — anything shared, live-patched or worth keeping across navigation:
the twelve lists. All of them are one implementation, `createCollection` +
`createCollectionEffects` in `shared/store`. A list is a name, a default sort and
an `idOf`; it is never a fresh actions/reducer/selectors trio.

**Not in NgRx** — the overview and the user detail page. One reader each, no live
stream, thrown away on close. They use `rxResource` in a plain service. Four files
to hold a value with one reader is ceremony, not architecture.

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

### The generic table

Every list renders through `shared/components/collection-table`, driven by
`ColumnDef[]`. A column names its key, its header, its `ColumnType` and a `value`
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
