---
name: admin-feature
description: Step-by-step runbook for adding a list to the admin panel — the contract row, the backend list endpoint, an audited operator action, the NgRx collection slice, the generic table's columns, chip tones, the live socket effect and the i18n keys the drift guard pins. Use when adding or changing any feature under apps/admin/src/app/<feature>/, or its backend half under apps/api/src/modules/admin/.
---

# Runbook: add a list to the admin panel

The lists that exist are **one implementation**. Adding another is assembling named pieces,
never writing a new actions/reducer/selectors trio. Architecture and reasoning:
`apps/admin/CLAUDE.md`. This is the order of operations.

Work outward: contract → backend → store → screen → dictionary.

**First, check it is a new list at all.** Four entries became two because the split was ours
rather than the product's: sales on a jar and sales to a card are one book, and so are USDT and
hryvnia top-ups. If the thing you are adding answers the same question about the same person as
an existing list, it is a **chip on that list** — a member of its filter enum, a `FilterChip` in
its columns file, and a case in the backend's `sliceFilter`. See "One book, cut by chips" in
`apps/admin/CLAUDE.md`.

**And whatever you add, link it.** Every id a row shows is an id somebody will want to follow.
Add the link to `shared/utils/links.util.ts` — one home, so a route that moves is a compile
error rather than a dead link — and render it with `ColumnType.ROUTER_LINK` or, for several,
`ColumnType.REFS`. A link carries `search`/`filter` as query parameters and the destination
applies them through `bindListQuery`; a link that merely opens a list is a link to a haystack.

---

## Step 1 — The row, in `@transacto/contracts`

```typescript
// libs/contracts/src/lib/interfaces/admin.interface.ts
export interface AdminFiatDepositListItem {
  readonly id: string;
  readonly telegramId: number;
  readonly username: string;
  /** UAH kopecks. */
  readonly amountUah: number;
  /** USDT cents. */
  readonly cryptoCents: number;
  readonly status: TmaFiatDepositStatus;
  readonly createdAt: string;
}
```

- **Name the unit in a comment on every money field.** Kopecks, USDT cents and whole USDT are
  all `number`, and the column type downstream is the only thing that keeps them apart.
- Ship counts, not collections: `receiptCount` rather than the receipts, unless the screen
  renders each one. A list row carrying a nested array puts personal data into a table nobody
  reads it from.
- Dates cross the wire as ISO strings.

If the list is live, add the socket event beside it:

```typescript
// ws/admin-events.enum.ts
FIAT_DEPOSIT_UPDATED = 'admin.fiat_deposit_updated',
// interfaces/admin.interface.ts
export interface AdminFiatDepositUpdatedEvent { readonly fiatDeposit: AdminFiatDepositListItem }
```

---

## Step 2 — The backend half

1. **`findPage`** on the domain's `-db` service — `find().sort().skip().limit().lean()` plus
   `countDocuments`, returning `Page<T>`. Mongoose lives nowhere else.
2. **A mapper** in `modules/admin/utils/admin-mapper.util.ts`: `toAdminFiatDeposit(record,
   username)`. Derive the counts here; do not leak the stored document.
3. **Sortable columns** in `ADMIN_SORTABLE` — a client may ask for any sort, and only this list
   is honoured.
4. **The service** (`modules/admin/services/admin-{feature}.service.ts`): `list()` using
   `clampLimit`, `toPageQuery`, `toPaginatedRes`, plus a `searchFilter` private method.
   Search matches the fields an operator actually carries in from elsewhere — a hash, a payout
   id, a card. **Status is not searchable as text**: it is an enum, and typing "review" must not
   half-match a card number.
5. **The controller**: `@Get()` for the list, one `@Post(':id/action')` for every intervention,
   both `@UserTypeAdmin()`.
6. Register the service, controller and `-db` module in `admin.module.ts`, and export from the
   `services/` and `controllers/` barrels.

### If the feature has actions

**Every write delegates to the service that already owns that operation.** Cancelling a sale
calls `SaleCancelService`; completing a fiat top-up calls
`FiatDepositSettlementService`. A second implementation is a second settlement path for the same
money. `TelegramMiniAppModule` exports those services for exactly this.

- One endpoint for all interventions of a feature; they share their lookup, their 409 and their
  audit shape.
- **Re-check the precondition on the server.** The row may have moved since it was drawn — a
  reconciler runs every thirty seconds — and an operator can reach the endpoint without a menu.
- **A `reason` is required by the DTO**, `@IsString() @MinLength(1) @MaxLength(ADMIN_REASON_MAX_LENGTH)`.
- **Audit after the write applied, never before.** If the settlement service answers `null`,
  nothing happened: throw `ERROR.ADMIN.ORDER_NOT_ACTIONABLE` and write no audit line. A journal
  claiming an action that did not happen is worse than no journal.
- Put the figures the decision turned on into the audit `metadata` — the row will have moved on
  by the time anybody reviews it.
- Add the `AdminAuditAction` members and the `AdminAuditTargetType` in contracts.

---

## Step 3 — The store slice

```typescript
export const FIAT_DEPOSITS_FEATURE = 'fiatDeposits';

export const fiatDepositsCollection = createCollection<AdminFiatDepositListItem>(
  FIAT_DEPOSITS_FEATURE,
  { defaultSort: 'createdAt', idOf: (row) => row.id },
);

const collectionEffects = createCollectionEffects(fiatDepositsCollection, () => {
  const api = inject(FiatDepositsApiService);
  return (query) => api.list(query);
});
```

- The live effect maps one socket event to `collection.actions.upserted`. `core/` never imports
  a feature; the feature subscribes.
- Action effects use **`exhaustMap`**, so a second click while the first is in flight is dropped
  rather than queued — the backend's conditional write is the second line of defence, not the
  first.
- `routes.ts` provides the state and effects route-scoped, so an unopened screen costs nothing.

`*.api.service.ts` is HTTP only, through `AdminHttpService` (`list`, `get`, `command`,
`remove`) — there is no `post`.

---

## Step 4 — The screen

- Columns in `constants/{feature}-columns.const.ts`: each names its `ColumnType` and a `value`
  returning the **raw** figure, never a formatted string. `ColumnType` is the single switch that
  keeps kopecks, cents and whole USDT from rendering as one another.
- **Bind `[rowId]="rowId"` on the table**, from the collection's own `idOf`. Without it rows
  track by position, and a list whose identity is guessed from a column pairs two rows that
  merely read alike.
- **Never re-derive a precondition the backend already answers.** A row says which actions it
  accepts (`allowedActions`), or contracts export the predicate (`isFiatDepositHeld`). A copy in
  a column file drifts the moment either side changes — it has, twice.
- A status column is `CHIP` + a `tone` from `shared/utils/tone.util.ts` + a `translatePrefix`.
  Add the tone map there and nowhere else; it is `Record<Enum, ChipTone>` with no fallback on
  purpose, so a new status fails to compile until somebody decides what it means.
- Row actions get a `visible` predicate. Prefer a predicate that already exists in contracts
  (`isFiatDepositHeld`) over restating the rule — that is what stops the menu and the backend's
  precondition drifting apart.
- The page component renders and delegates: `store.selectSignal`, `dispatch`, and a
  `ReasonDialogComponent` for each action. `ACTION_COPY` is a `Record<Action, …>` lookup rather
  than a `switch`, so a new action fails to compile until its copy exists.
- Add the route in `app.routes.ts` and the entry in `shell/nav.const.ts`.

---

## Step 5 — The dictionary, and the guard that pins it

`src/assets/i18n/uk.json` is the only dictionary. Add:

- the `nav.*` label and the feature's own `{feature}.*` block (title, subtitle,
  `search_placeholder`, `empty`, every column header, every chip, every action label and its
  confirmation), plus any `links.*` tooltip a new cross-link needs;
- a `{ENUM}_STATUS` section if the list renders a new status enum;
- the `AUDIT.*` and `AUDIT_TARGET.*` members for any new audit action;
- an `errors.<code>` line for every new `ERROR` code the screen can surface.

**Then pin the concatenated families in `shared/i18n.spec.ts`.** `'FIAT_DEPOSIT_STATUS.' +
status`, `'AUDIT.' + action` and `'errors.' + code` appear nowhere in the source, so nothing
else notices a missing one — the cell simply renders its own key.

```typescript
it('covers every fiat top-up status', () => {
  expectEveryMember('FIAT_DEPOSIT_STATUS', Object.values(TmaFiatDepositStatus));
});
```

---

## Step 6 — The gate

```bash
npx nx run-many -t lint typecheck build test -p admin api contracts
```

A contract change and both consumers land in the same commit; there is no version to bump.
