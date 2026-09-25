# Refactoring Backlog — Backend

Where the current code diverges from [CLAUDE.md](./CLAUDE.md).

**This is a backlog, not a precedent.** New code follows the rules; existing code listed here
is scheduled for the structural refactor. Don't copy these patterns.

---

## 1. Extract the repository layer — ✅ DONE

All nine collections live in `src/modules/repositories/**`: `alerts-db`, `order-db`,
`safe-box-db`, `terminal-db`, `terminal-history-db`, `tma-user-db`, `tma-deposit-db`,
`tma-sale-db`, `trader-db`. Each has `schemas/`, `services/`, `index.ts` barrels and
its own `-db.module.ts` owning `MongooseModule.forFeature`.

The only Mongoose reference outside `repositories/**` is `MongooseModule.forRoot()` in
`app.module.ts` — the global connection, which belongs there.

Verified by booting the built image: the whole DI graph resolves.

<details><summary>Original plan (kept for reference)</summary>

Every schema and DB service used to live inside its domain module, which the isolation rule
forbids.

For each row: move the schema to `repositories/{domain}-db/schemas/`, the service to
`repositories/{domain}-db/services/`, add `{domain}-db.module.ts` with
`MongooseModule.forFeature()` + `exports`, add `index.ts` barrels, then have the domain module
import the `-db` module instead of registering the schema.

| Current schema | Current DB service | Target `-db` module |
|---|---|---|
| `alerts/schemas/alert.schema.ts` | `alerts/services/alerts-db.service.ts` | `repositories/alerts-db/` |
| `order-tracking/schemas/order.schema.ts` | `order-tracking/services/order-db.service.ts` | `repositories/order-db/` |
| `safe-box/schemas/safe-box-deposit.schema.ts` | `safe-box/services/safe-box-db.service.ts` | `repositories/safe-box-db/` |
| `terminal/schemas/terminal.schema.ts` | `terminal/services/terminal-db.service.ts` | `repositories/terminal-db/` |
| `terminal-history/schemas/terminal-history.schema.ts` | `terminal-history/services/terminal-history-db.service.ts` | `repositories/terminal-history-db/` |
| `trader/schemas/trader.schema.ts` | `trader/services/trader-db.service.ts` | `repositories/trader-db/` |
| `telegram-mini-app/schemas/tma-user.schema.ts` | `telegram-mini-app/services/tma-user-db.service.ts` | `repositories/tma-user-db/` |
| `telegram-mini-app/schemas/tma-deposit.schema.ts` | `telegram-mini-app/services/tma-deposit-db.service.ts` | `repositories/tma-deposit-db/` |
| `telegram-mini-app/schemas/tma-sale.schema.ts` | `telegram-mini-app/services/tma-sale-db.service.ts` | `repositories/tma-sale-db/` |
| `extension/schemas/**` | — | fold into the owning `-db` module |

**Decided:** the `telegram-mini-app` domain gets **three separate `-db` modules**, one per
collection — not a single combined `tma-db`. The domain module imports all three.

After the move, no file outside `repositories/**` may import `mongoose` or `@nestjs/mongoose`.

</details>

## 1b. Three WebSocket events are dead — decide whether to switch them on

Moving the schema hooks into services showed that three of the seven events never fire. The
hooks assume every write is a `save()` or `findOneAndUpdate`, but the services use
`updateOne` / `bulkWrite`, which trigger neither.

| Event | Status |
|---|---|
| `TERMINAL_BALANCE_UPDATED` | ✅ live — emitted directly from a service |
| `TERMINAL_ALERT_TRIGGERED` / `RESOLVED` | ✅ live — `create()` and `findByIdAndUpdate()` |
| `TERMINAL_HISTORY_UPDATED` | ✅ live — `new Model().save()` |
| `TRADER_DEACTIVATED` | ✅ **fixed** — now emitted from `TraderDbService.deactivateTrader()` |
| `TERMINAL_ENABLED` | ✅ **fixed** — `TerminalBroadcastService.announceEnabled` |
| `TERMINAL_DISABLED` | ✅ **fixed** — `TerminalBroadcastService.announceDisabled` |

Both blockers that kept these dead are gone.

**The payload is no longer thin.** `TerminalEnabledDto` was `{ terminalId, cardId }`, which is
not enough to draw anything — the client added a near-empty row and waited for a balance
broadcast to fill it in. It is now a whole card, in the same shape a dashboard row arrives in,
and the client maps both through one function so a live card and a reloaded one cannot disagree.
It carries `lastBalance` / `lastGoal` from the terminal document, which is the point: a terminal
is announced the instant it exists and the scraper's first pass is seconds to minutes behind, so
the figures already stored are what let the card be complete straight away.

**The burst risk is answered by only announcing changes.** The sync compares each upstream row
against what it already held and announces the ones that *became* enabled — not every terminal
it upserted. On a steady account that is nothing, every pass. The re-read is one batched query
for the whole set, so the cost does not grow with the number of terminals.

Emitted from three places, each the one that knows the transition happened:
- `TerminalDeactivationService` — the single owner of teardown, last of all, once the row and
  the cache are settled. Announcing earlier would take the card off screen while the terminal
  was still half in service.
- `TerminalsSyncService` — terminals that appeared or came back upstream.
- `SaleFacadeService` — a Mini App terminal, at creation, rather than up to a minute
  later on the next cron pass.

## 2. Third-party API services — ✅ DONE for `bank-scraper`

Every outbound bank call now lives in `bank-scraper.api.service.ts`, which also owns the shared
axios instance: proxy rotation and retry/failover are properties of how we talk to banks, and it
is the only class that does. The old `BANK_AXIOS_INSTANCE` token and its provider file are gone.

`transacto/services/transacto-api.service.ts` already had the right shape and suffix.

## 3. `ERROR` constants — ✅ DONE

Created in `@transacto/contracts` (not the backend, so frontends can switch on `code`) as
`libs/contracts/src/lib/constants/errors.ts`. Ten domains in increments of 100. 45 throw sites
across 20 files converted; nothing raises a bare string or bare `Error` any more.

Dynamic detail is preserved rather than flattened — the constant is spread and a `details`
string added, so the code stays stable while the user still sees amounts and limits.

## 4. Structural odds and ends

- `alerts`, `order-polling`, `safe-box`, `terminal`, `terminal-history`, `trader`, `transacto`
  have no `{domain}.controller.ts` — confirm each is intentionally internal-only.
- `extension` and `telegram-mini-app` use a `controllers/` folder; the spec expects a single
  `{domain}.controller.ts` at module root.
- ✅ **`bank-scraper` — normalised.** `services/{api,cache,core,processing}/` collapsed into a
  flat `services/`, the three `strategies/{bank}/` folders into one file per bank, and
  `dto/unified-bank-balance.res.dto.ts` — never a controller response — became
  `shared/interfaces/bank-balance.interface.ts`.
  - `BankScraperFacade` → `BankScraperService`, and its `switch (provider)` became a lookup over
    strategies injected under `SCRAPER_STRATEGIES`. Each strategy declares its own `provider`,
    so a new bank is a new class plus one line in the module.
  - Response adapters are pure functions in `shared/utils/bank-response.util.ts` — and therefore
    testable, which is how the `refEnv` bug below was found.
- `webhook` has `enums/` and `guards/` but no `services/` — logic sits in the guard.
- `GET /api/tma/deposits/:id` answers a miss with `200 { error: 'Deposit not found' }` instead
  of a 404 carrying `ERROR.DEPOSIT.NOT_FOUND`. Left alone so far because the fix changes a
  response shape the mini-app may read; settle it with the frontend in Phase 4.

## 4b. Two bugs surfaced by the `bank-scraper` normalisation

**PrivatBank `refEnv` parsing was broken on the double-encoded payload.** The old adapter did
`value.split('"payload":"')[1].split('"')[0]`, but `split('"')` cuts at the *first* quote, which
in `{"payload":"{\"refEnv\":\"X\"}"}` lands immediately after the opening backslash. The result
was `{\`, `JSON.parse` threw, and the scrape failed with `PROCESSING_FAILED`. Only the
`else` fallback ever worked, so PrivatBank scraping succeeded solely when the bank returned the
unescaped form. Fixed by parsing instead of slicing — the outer value is valid JSON, so no string
surgery was ever needed. Covered by tests for all three shapes.

**A dead PUMB box was never retired.** ✅ FIXED.

`ScraperExecutionService` resolves the status as `error instanceof HttpException ?
error.getStatus() : isAxiosError(error) ? error.response?.status : undefined` — the
`HttpException` branch wins. PUMB caught the bank's 404 and rethrew it as
`BadRequestException`, i.e. **400**, which then *masked* the real status. So `handleDeadJar`
never fired: a deleted PUMB box was polled forever, the terminal stayed enabled in Transacto,
and its pending orders were never failed.

PrivatBank was unaffected — it rethrows the raw axios error, so the second branch reads the real
404. The bug was not a missing mapping but an incorrect one.

Both mappings are now `toBankHttpError` in `src/shared/utils/bank-http-error.util.ts`, so every
bank answers the same failure the same way and a new bank cannot get it wrong. The status table
it must preserve is documented on the function, and pinned by tests.

> **Behaviour change worth knowing:** a PUMB 404 now takes a destructive action it previously
> skipped — the terminal is disabled via the Transacto API and its pending orders are failed.
> That is the intended fix and matches Monobank, but it is the first time this path can fire
> for PUMB.

⬜ Still open, deliberately: `adaptPumbBalance` throws `TERMINAL.INACTIVE` (400) when the box
responds with a status other than `ACTIVE`. That is a *different* condition — the box exists but
is closed — and retiring on it would need to know which PUMB statuses are terminal and which are
transient. Left alone rather than guessing, since the action is destructive.

## 4c. Alerts stored a rendered English sentence — ✅ FIXED

`Alert.message` was a **required** column holding a hand-built English sentence, e.g.
`Ambiguous deposit of 5000 kopecks. Found 3 possible combinations.` One language, frozen at
write time, for a UI that ships in three.

Now the document holds `type` (the translation key) and `metadata` (its parameters), typed
per-type by `AlertMetadataMap` in contracts. `message` is gone from the schema, the DTO and the
client. The English sentence survives only as a `logger.warn` line, which is right — logs are
for operators.

**This was not only a design problem.** Two of the four alert types persisted *no metadata at
all*, so the values their translations interpolate existed nowhere but inside the English
string:

| Alert type | Was stored | Client rendered |
|---|---|---|
| `AMBIGUOUS_DEPOSIT` | nothing | "Found **&nbsp;** combinations of orders…" |
| `UNRECOGNIZED_DEPOSIT` | nothing | lost `totalDelta` |

Both now carry complete metadata, and `getPendingAlertsOfType<T>` returns metadata narrowed to
the type it filtered on, so reading `alert.metadata.left` type-checks without a cast.

**Existing rows:** nothing breaks — Mongoose ignores the now-unknown `message` path. But alerts
created *before* this deploy and still `PENDING` have no metadata, so their descriptions render
with blank interpolations until they resolve. To tidy the column once they have:

```js
db.alerts.updateMany({}, { $unset: { message: 1 } })
```

## 4d. Part-payments executed orders and then disabled the terminal — ✅ FIXED

Reported from a live test: a 96.00 UAH order, a 50.00 UAH deposit. The order was executed
anyway, the unmatched-deposit alert vanished, and the terminal was disabled for fraud.

From the logs:

```
09:50:34  Unmatched deposit of 5000 kopecks … total delta of 5000     → alert raised
09:50:40  Executing order {orderId:1381799, amount:9600} (FUZZY MATCH)
09:50:41  Updated baseline for terminal 23715 to 10000
09:50:41  alert_resolved
09:50:48  🚨 FRAUD. Balance dropped from 10000 to 5000 … Disabling credential
```

**Cause.** `evaluateDelta` also tried `totalDelta + <sum of unresolved alerts>`, intending to let
a later deposit combine with an earlier unmatched one. But the baseline only advances when money
is accounted for — a match here, or the trader resolving an alert — so an *unresolved* deposit is
still inside `totalDelta` by construction. Adding it back double-counts:

| | |
|---|---|
| real delta | 5000 |
| unresolved alert for that same 5000 | +5000 |
| phantom delta evaluated | **10000** |
| order amount | 9600 |
| difference | 400, inside the 500-kopeck fuzzy tolerance → **match** |

Two deposits genuinely combining never needed this: the second simply makes `totalDelta` their
sum, because the baseline has not moved.

**Second fault, downstream.** The fuzzy branch then set `baseline = baselineBalance +
matchResult.amount`, using the phantom 10000 rather than the money present. The baseline ended
above the real balance, so the next scrape read a 5000 drop as a withdrawal and disabled the
terminal. Both branches now set `baseline = currentBalance` — identical arithmetic in the correct
case, but it states the invariant: the baseline can never exceed the money actually in the jar.

Covered by `subset-sum-matcher.service.spec.ts`, which reproduces the incident's exact figures.
The spec sets `FUZZY_MATCHING_ENABLED=true` explicitly — without it the assertions pass for the
wrong reason, since jest loads no `.env` and fuzzy matching is simply skipped.

## 4e. Scraper noise: duplicate query, unconditional broadcast, repeating warning — ✅ FIXED

Three separate things made the log unreadable and the system busier than it needed to be.

**A dead DB query per scrape.** `scraper-execution.service.ts` fetched
`getPendingOrdersForCard(cardId)` and computed `hasPendingOrders` / `pendingOrdersSum` — then
never used them, because `broadcastBalanceUpdate` runs the same query itself. Two identical
queries per terminal per poll, one wasted. (These were the `no-unused-vars` warnings in §6b;
they were pointing at real waste, not style.)

**A WebSocket event per poll regardless of change.** The scraper polls every ~5s per terminal
whether or not anything moved, and every poll pushed `TERMINAL_BALANCE_UPDATED` to every
connected extension. Nine terminals meant a couple of events a second, forever, none of which
changed anything on screen. Broadcasts are now suppressed when the payload is identical to the
last one, with a heartbeat so the terminal is not read as dead.

**The same warning every few seconds.** An unmatched deposit stays unmatched until the trader
resolves it, and every poll re-reaches that branch. `createAlert` already deduplicated the alert
row, but the `logger.warn` above it ran unconditionally. Both the unrecognized and ambiguous
branches now log on first sighting only.

> ⚠️ **`BROADCAST_HEARTBEAT_MS` and the extension's `Polling.STALE_AFTER_MS` are coupled.**
> The extension lights its "polling" indicator from the age of the last balance update, so the
> threshold must exceed the worst-case silence:
>
>     heartbeat 15s + poll interval and jitter 7.5s + bank timeout 10s = 32.5s
>
> The extension now allows 45s (was 25s). **Ship the extension before the backend** — a client
> still on 25s would read the longer silence as a dead terminal.

## 4f. The balance event never carried the jar goal — ✅ FIXED

Reported: after the first scrape the card's balance updates but the goal stays at 0.00.

`TERMINAL_BALANCE_UPDATED` had no `goal` field. The scraper reads it
(`balanceData.goal`), caches it in Redis and serves it over REST from
`extension-dashboard.service.ts` — but the socket event omitted it, so a terminal whose first
scrape happened *after* the popup loaded kept whatever REST gave it, which was 0.

Confirmed against the live cache while reproducing: `terminal:state:current:23715` held
`{"current":20400,"goal":300000}` while the extension displayed ₴204.00 against a ₴0.00 goal.

Two visible effects, not one. The progress gradient is `balance / goal`, and
`terminal-card.component.ts` falls back to `balance === 0 ? 0 : 100` when the goal is missing —
so every funded terminal also rendered as a full bar.

`goal` is now on the DTO, in the broadcast payload and in the dedupe signature, and the store
applies it. It stays optional: a bank that reports no goal sends nothing rather than 0, and the
store's undefined-stripping keeps the last known value — a scrape without a goal says nothing
about the goal.

## 4g. Sync button 404, and a watchdog that gave up — ✅ FIXED

Two failures on the same terminal, with one shared root: the Mini App stores its terminals under
`traderId: 0`, and the Transacto sync then stores a second copy under the real trader. Terminal
25144 existed twice, and only the trader-scoped copy is usable.

**`POST /extension/terminals/:terminalId/sync` always 404'd.** `forceSyncTarget` took the bank's
`targetId` and matched it with `cred3.includes(...)`, while the controller handed it the route's
`:terminalId`. The lookup only succeeded when the terminal id happened to appear inside the jar
URL. Renamed to `forceSyncTerminal`, which looks up by `{ traderId, terminalId }` — what the
route says, what the client sends, and it keeps the ownership check that stops one trader syncing
another's terminal.

**One orphan terminal aborted the entire watchdog pass.** The trader lookup was
`ensure(trader?.apiToken, new NotFoundException(...))` *inside* the loop, while the `try/catch`
sits outside it. A terminal with no active trader — the `traderId: 0` copy — threw, and every
terminal after it stayed dead until the next minute, when it failed at the same place again.
Those terminals have no API token and cannot be scraped anyway, so they are now skipped with a
debug line, without claiming the heartbeat.

Verified live: the watchdog logs `skipping terminal 25144 — no active trader 0` and revives all
four real loops with no error, and the endpoint answers 201 for 25144 and 23715 while still
404ing a terminal the caller does not own.

⬜ The duplicate document is left alone. `sale-facade` upserts on `{ cardId }` with
`traderId: 0`, while `terminals-sync` upserts on `{ traderId, cardId }`, so one real terminal is
two rows. Nothing reads the orphan now, but whether the Mini App should store under the service
trader's real id is a data-model call, not a bug fix.

### Terminals switching themselves off after Mini App sales — ✅ FIXED

Reported as "terminals turn off every few minutes once sales are created from the TMA".
`TerminalsSyncService.deactivateRemovedTerminals` was the cause, and it had three separate ways
to reach the same wrong conclusion — that a terminal had been deleted upstream.

1. **It compared a stale snapshot against a fresh read.** The upstream list was fetched at the
   top of the pass; `syncTraderTerminals` then ran a `findOne` per terminal, awaited in
   sequence and used only to choose a log line; and only then did the deletion check re-read
   Mongo. A sale landing in that window wrote its terminal row — enabled, correct —
   after the snapshot was taken, so the check saw a local terminal that "no longer existed
   upstream" and stood it down, seconds after the user was told the jar was ready. The window
   grew with the terminal count, and Mini App terminals accumulate (`disable()` never deletes,
   only disables), so it widened with every order created. The pass now stamps `observedAt`
   *before* the fetch and skips any row created after it, and the N+1 loop is one `find`.
2. **`enable_orders ?? false`.** The field is optional on the response, so a rename, an
   omission, or any unexpected shape disabled every terminal of every trader on the next tick.
   `resolveEnabled` now returns `null` for "upstream did not say" and the `$set` omits
   `enabled` entirely; a brand-new row gets `$setOnInsert: { enabled: false }` rather than the
   schema's `default: true`.
3. **One missing read was treated as proof.** `credentials_list` is a single unpaginated call
   over a list that grows with every sale, so a truncated page looks exactly like a
   deletion. A terminal now has to be absent from `MISSING_PASSES_BEFORE_DEACTIVATION` (3)
   consecutive syncs, and `MAX_DEACTIVATION_SHARE` refuses any pass that would take down more
   than half of a trader's active estate at once (with a `MIN_MASS_DEACTIVATION` floor, so a
   one-terminal trader is not exempt from ordinary cleanup). Both log loudly instead of acting.

⬜ **`credentials_list` is still unpaginated.** `getOrdersList` passes an explicit `limit`;
`getTerminalsList` passes nothing and trusts the whole list to come back. Since the Mini App
adds a terminal per sale and never removes one, that list only grows — the share guard
turns truncation into an error log rather than an outage, but the real fix is either paging the
endpoint or archiving retired Mini App credentials upstream. Needs Transacto's actual contract,
which is not knowable from this side.

✅ **Fixed: the extension is told when a terminal appears or goes.** Both events are live — see
the WS table above. A disabled terminal now leaves the dashboard as it is disabled, except when
it still has unread alerts, which the client keeps deliberately: dropping one would take the
trader's only notice of what went wrong with it.

### A user could not stake their whole balance — ✅ FIXED

Reported as "balance 100 USDT, but only 99,99 can be entered". The Mini App derives the order's
UAH target from the typed USDT, then derives the stake back out of that target. Both steps
quantised to a whole hryvnia with `roundToWholeUah` — to *nearest* — so the target could round
**up** and the stake came back one cent above what was typed.

Only whole USDT amounts were immune, which is why every existing test missed it and why the
first attempt to reproduce it at exactly 100,00 failed. Swept over integer rates and profit
rates of 1/2/3%, **29% of possible balances could not be spent in full** — a balance of 10,02
quoted 10,03. Real balances are whatever a deposit at a market rate left behind, so this was
common rather than exotic.

`floorToWholeUah` is now in `@transacto/contracts` alongside `roundToWholeUah`, and the create
form's `equivalentKopecks` / `targetKopecks` use it. The two are deliberately not
interchangeable: `roundToWholeUah` *normalises* a figure that already exists — the goal a bank
reports, where nearest is right — while `floorToWholeUah` *derives* one, where the direction
has to be the user's. The same sweep against the floored version: 0 out of 295 005. The cost is
that an order may be up to one hryvnia smaller than the exact conversion, always in the user's
favour. The server needed no change: it receives the already-quantised target and its
`roundToWholeUah(fiatAmount)` is a no-op guard on it.

### Cancelling refunded money the user had already received — ✅ FIXED

`SaleCancelService.split` measured the refund against `order.receivedAmount`, which
counts **only** hryvnia matched to a settled Transacto order. The jar can hold money no order
accounts for — an unrecognised or ambiguous deposit the matcher could not attribute, or a
payment that landed without an order behind it — and `canCancel` refuses to cancel while any
order on the card is unsettled, so this is exactly the state a cancellation is most likely to
find. The whole stake went back while the hryvnia sat in the user's own bank.
`isSaleFunded` already had to reckon with the same gap to decide completion; the refund
did not.

The measure is now `saleDeliveredFiat` (`src/shared/utils/sale-funding.util.ts`):
the greater of matched orders and the jar's **growth**. Growth, not balance — a user may point
an order at a jar that already held money, and that hryvnia was theirs before any of this
started. The baseline is a new `openingJarBalance` on the order, seeded by the first
`updateJarBalance` through `$ifNull` in an aggregation-pipeline update so no later scrape can
move it; that first scrape lands within seconds of the terminal being created, before Transacto
could have routed an order to it.

⬜ **Orders that predate this carry `openingJarBalance: null`**, and an unknown baseline is
deliberately not charged for — those orders keep the old matched-orders-only behaviour on
cancellation. Backfilling is not safe: for an order already in flight, today's jar balance is
not the balance it started with. It ages out as those orders close.

### `orders_execute` 108 aborted the scrape and looped forever — ✅ FIXED

Transacto answers `POST orders_execute` with `400 {"error_code":108,"error_message":"Insufficient
trader limit"}` when the trader's limit is exhausted. `executeOrder` special-cased only 107, so
108 was re-thrown — and the call sits on the *first* line of the match loop in
`OrderMatcherService`, so the throw skipped everything after it: `markCompleted`, the baseline
advance, `resolvePendingAlertsForJar`, and the `TERMINAL_ORDERS_EXECUTED` emit the Mini App's
sales depend on.

`ScraperExecutionService` caught it, logged, and called `scheduleNext`. The next scrape read the
same unchanged baseline, computed the same delta, matched the same order and failed at the same
line — **several times a minute, indefinitely**, with the payer's money sitting in the jar, the
order stuck PENDING and no alert of any kind. Operators only ever saw `logger.error`.

`executeOrder` now returns an `OrderExecutionOutcome` instead of throwing on 108. The matcher
settles the order exactly as it would have, flags `awaitingUpstreamConfirmation`, and raises
`AlertType.ORDER_CONFIRMATION_FAILED`, whose metadata carries `orderStringId` and `errorCode` so
the extension can tell the trader which order to confirm in the cabinet. **Only 108** is
absorbed; every other code still throws, so a malformed payload cannot be filed as a spent limit
and silently credited.

The alert gets its own create/resolve pair rather than using `createAlert`, because the shared
deduplication key is `(terminalId, type, amount)` and two different orders for the same amount on
one jar are two separate pieces of work; these key on `metadata.orderId`.
`OrderSyncService.retryUpstreamConfirmations` re-offers them every five minutes — the limit
resets on its own — and resolves the alert when one is finally accepted, giving up after
`MAX_UPSTREAM_CONFIRMATION_ATTEMPTS` asks without clearing the alert.

**A second, pre-existing bug came out of this.** `isTracked()` counted only PENDING and PAUSED,
so it answered `false` for a settled order — while `track()` upserts `status: PENDING`
unconditionally. Every caller that guards on `isTracked` before enqueuing therefore *resurrected*
executed orders: `orders_list` keeps reporting `status_id === 2` until Transacto's own state
catches up, and the 30-second sync pushed the order back into polling to be matched and executed
again. For an order refused with 108 that state never catches up, so it looped for good — but the
same window exists for any normally-executed order whenever Transacto lags. EXECUTED now counts as
tracked. CANCELLED deliberately does not: the stale check closes orders that merely fell out of
the top 100, and one that reappears upstream has to be allowed back.

⬜ **The money risk is accepted, not solved.** An order is credited locally on the strength of
money we can see in the jar, while Transacto still considers it open. If the trader never confirms
it and Transacto expires it, we will have paid USDT for hryvnia that gets refunded to the payer.
This was a deliberate call; the alert and the retry are what keep the window short.

⬜ **`ExtensionAlertsActionService.forceMatch` has the same hole**, from before this change: it
marks the order EXECUTED locally, then calls `executeOrder` and only `logger.warn`s on failure.
A trader can force-match, have the confirmation refused, and see nothing. It should go through
the same outcome handling.

### Alerts rendered `{{amount}}` instead of the number — ✅ FIXED

`ExtensionDashboardService` had the same six lines twice, in `getDashboard` and `getAlerts`:
spread `metadata` onto the alert root, then `delete` it. That dated from when the template
interpolated the alert itself (`| translate: alert`); it now passes `alert.metadata`, so the pipe
received `undefined` and printed the translation with its placeholders intact — "Mismatch of
{{amount}} UAH".

Only the REST path flattened. `AlertDbService.emitAlertEvent` sends the document as-is, so an
alert arriving live over `TERMINAL_ALERT_TRIGGERED` interpolated correctly and *the same alert
after a reload did not* — which is why it read as intermittent rather than broken.

Both routes now go through one `toAlertDto`, which keeps `metadata` nested and adds `id` /
`alertId` exactly as the socket payload does. That is what `TerminalAlertDto` in
`@transacto/contracts` has described all along; the REST route was simply not honouring it.

⬜ **`TERMINAL_FULL_WARNING` can carry a negative `left`.** `checkJarFullWarning` computes
`remaining = goal - currentBalance` with no floor, so a jar past its goal produces
`left: -10300` and the sentence reads "Only -103 UAH left to reach the goal". It was invisible
while the placeholder was never substituted. Clamping to zero or giving an over-goal jar its own
message is a product call, not a bug fix.

### Manual sync reverted on reopen, and a broken jar-balance query — ✅ FIXED

Two unrelated faults, reported together.

**The dashboard reported the wrong number.** `getDashboard` read the scraped balance out of
`getCurrentState` and then overwrote it with `getBaseline` unconditionally. Those are not the
same figure: the baseline is the fraud detector's reference point, the money already accounted
for by matched orders, and it moves only when orders match. A manual sync therefore *looked*
like it worked — the fresh figure goes out over `TERMINAL_BALANCE_UPDATED` and the live UI takes
it — and reverted the instant the extension was reopened and re-read this endpoint. Now
`currentState?.current ?? baseline ?? 0`, keeping the baseline as the fallback it was presumably
meant to be: `current` carries a one-hour TTL and the baseline does not.

**`updateJarBalance` threw on every scrape that moved a Mini App jar.** Seeding
`openingJarBalance` through `$ifNull` in the same update makes it an aggregation pipeline, and
Mongoose 9 refuses an array update without `updatePipeline: true` — at runtime, not at compile
time, so `nx typecheck` and every mocked test stayed green:

    Cannot pass an array to query updates unless the `updatePipeline` option is set.

`SaleProgressListener` catches its own failures, so it never propagated; it just logged
and left `jarBalance` unwritten, which silently disabled both the jar-growth half of
`saleDeliveredFiat` and completion by jar balance.

That it survived the gate is the point worth keeping. Every DB-layer spec here mocks the DB
service wholesale, which replaces the very thing a malformed query lives in. Mongoose validates
an update while *building* the query, before any I/O, so `tma-sale-db.service.spec.ts`
now drives a real model on an unconnected instance and stubs only the execution — enough to
prove the query is well-formed, with no database and no measurable cost. Worth copying for any
other non-trivial query.

### A manual top-up raised an alert instead of closing the jar — ✅ FIXED

`TERMINAL_FULL_WARNING` fires when a jar is within one minimum order of its goal, because
Transacto cannot route an order that small — it is the trader's cue to pay the remainder in by
hand. They do, and the scraper then saw a deposit no pending order accounted for and filed it as
`UNRECOGNIZED_DEPOSIT`: a second alert raised for doing exactly what the first one asked, while
the jar sat full, the baseline never advanced and the sale stayed open.

Two readings of the same fact had drifted apart. `isSaleFunded` already knew that a jar
holding its target, with an unaccounted remainder smaller than one routable order, is the
trader's top-up — that is its second route to completion. The scraper's matcher knew nothing
about it. `isGoalClosingTopUp` now states that rule from the terminal's side, in the same file,
so the two cannot disagree again; `processDelta` takes the jar's goal in order to apply it.

On that path the matcher does everything an ordinary match does except execute an order, because
there is none: it advances the baseline (without which the same deposit is re-evaluated on every
scrape and eventually files itself as unknown anyway) and resolves the jar's alerts — including
`TERMINAL_FULL_WARNING`, whose remainder has just arrived. `resolvePendingAlertsForJar` took a
`types` parameter for that; an ordinary order match still clears only the two deposit alerts,
since matching an order says nothing about whether the jar is still short.

Completing the sale and standing the terminal down is deliberately left where it
already lives: `broadcastBalanceUpdate` has gone out with the new balance before this runs, and
`SaleProgressListener` decides funding on the same rule, so the Mini App closes its own
order and disables its own terminal exactly as it does when a final order matches. **That path
depended on `updateJarBalance`, which was throwing on every write until the `updatePipeline` fix
— so before that, completion by jar balance could never fire at all.**

`checkJarFullWarning` also now requires `remaining > 0`. The warning names a remainder for the
trader to pay; once the goal is met there is none, and the old condition recreated the alert
with `left: 0` — or, past the goal, a negative one, which rendered as "only -103 UAH left". That
closes the open item noted against the alert-interpolation fix above.

### The drop link and the card number were never checked against each other — ✅ FIXED

A sale takes a drop link and a 16-digit card number as two independent fields, and
nothing verified they belonged to the same account. A user who pasted one person's envelope and
typed another person's card got an order that could never settle: Transacto routed payers to the
card, the money never reached the jar we were watching, and the mistake surfaced three expired
orders later as an `ORDERS_EXPIRED` block — stake frozen, nothing explaining why.

PrivatBank's envelope record names the card it pays into. Confirmed against a live envelope: the
public `envelopes/pubinfo` handshake — no auth, no proxy, anyone holding the share link — returns
`card`, `iban`, `ownerName` (masked to a surname and an initial), `goalAmount`, `deposit` and
more, of which we were reading three fields.

`DropLinkResolverService` now reads it at resolve time, so `ResolveDropLinkRes` carries
`cardNumber` and `ownerName`; the create form fills the card in for the user, and
`createSale` refuses a mismatch before anything is frozen. `null` means "not known" and
never "does not match" — Monobank and PUMB report no card, and refusing those would break two
banks to guard one. The handshake itself is `BankScraperApiService.fetchPrivatEnvelope`, a
session-less variant of what `PrivatScraperStrategy` already does, rather than a second copy of
PrivatBank's three-step dance.

**PrivatBank also had no creation-time goal check at all.** `resolve()` returned `goal: null` for
it, which the facade reads as "not known" and skips — so the recommended bank was the one where a
wrong jar target was only caught later, by `SaleComplianceService`, once the order was
already running. `goalAmount` from the same call closes that.

⬜ **`card` and `iban` are full payment credentials and must never reach a log line.** The
declared `PrivatRawResponse` says so at the field, and nothing logs them today — but this is the
same hazard as `cred` in the webhook payload, and the same discipline applies: build log lines
from named fields, never from the response body.

⬜ **`deposit` is a lifetime cumulative total, not the current balance.** Verified on a live
envelope: withdrawing the whole balance left `deposit` at `800.00` while `availableBalance` went
to `0.00` and `goalCompletionPercentage` fell to 0. Nothing uses it yet, and it is worth more
than it looks — see the note in `bank-response.util.ts`.

### The trader's API token was being written to the logs — ✅ FIXED

Surfaced by an ordinary Transacto outage: `credentials_list` answered 502 for both traders, the
sync logged the failures, and the log line contained
`'X-API-TOKEN': '235b5f9a…'` in full.

`logger.error(msg, axiosError)` serialises the error, and an `AxiosError` carries `config` —
including the request headers. Every Transacto call sends the trader's token in one, so **any**
upstream 5xx printed a live credential in plaintext, on a cron that runs every minute. That
token lists terminals, executes orders, creates credentials and disables them.

A second site was worse because it was deliberate rather than accidental:
`OrderMatcherService` logged `` `Executing order …\nX-API-TOKEN: ${apiToken}` `` on the *success*
path, in both the perfect- and fuzzy-match branches — so the token was written on every single
matched order, not only on failures.

`describeError` / `describeErrors` in `src/shared/utils` now reduce a failure to the method, path,
status, code and message. Written as a whitelist rather than a redaction: a filter has to be kept
in step with whatever axios adds to `config` next, and reconstructing the line does not. The
matcher's log lines name the order, its amount and its card, which is what an operator was
actually reading them for.

⬜ **The exposed token needs rotating**, and this is the third instance of the same class in this
codebase — the webhook guard printed the expected HMAC signature, `describeDelivery` exists
because dumping a webhook body would print card numbers, and now this. The rule worth stating
once: **never pass a caught error, a request config or a third-party payload to a logger; build
the line from named fields.**

### A missing module import shipped past the entire gate — ✅ FIXED

`DropLinkResolverService` gained a `BankScraperApiService` constructor argument. The `import`
statement for `BankScraperModule` landed in `telegram-mini-app.module.ts`; the entry in
`imports: []` did not. Lint, typecheck, build and all four test suites passed, and the app then
refused to boot with `UnknownDependenciesException`.

Nothing in the gate could have caught it. **Every spec here builds services with `new` and
hand-made collaborators**, so the Nest container is never exercised — a provider that is injected
but never registered is invisible until a real boot.

`telegram-mini-app.module.spec.ts` now compiles the module's actual dependency graph. The trick
is what it refuses to mock: the usual `useMocker(() => ({}))` would have invented the missing
`BankScraperApiService` and passed happily. Only genuinely external providers are stubbed — the
Mongoose connection and its models, BullMQ queues, and the globals `AppModule` registers
(`REDIS_CLIENT`, `EventEmitter2`, `SchedulerRegistry`) — named in one explicit list, because the
looser that list gets the less of the graph the test still checks. Anything else unresolvable
throws by name. Verified by removing `BankScraperModule` again: the suite fails with
*"BankScraperApiService is injected somewhere in TelegramMiniAppModule but is not registered in
it."*

Worth extending to the other feature modules — this one has the test because it is where the bug
happened, not because it is the only module that can have it.

**A Jest config gap came out with it.** `https-proxy-agent`, `agent-base` and
`proxy-agent-negotiate` ship ESM only, and `node_modules` is untransformed by default, so any
spec importing the bank-scraper barrel died on `Cannot use import statement outside a module`.
Five specs had grown a `jest.mock('src/modules/bank-scraper')` to dodge it — a per-file plaster
over a config gap, and one that made a real DI test impossible, since stubbing that module is
precisely what such a test must not do. `transformIgnorePatterns` now lets those three through
and all five workarounds are gone.

### Per-trader upstream calls are staggered — ✅ DONE

`Promise.allSettled(traders.map(...))` fired every trader's request in the same tick, and the
terminals sync and the order sync land on the same second — so Transacto saw four simultaneous
calls a minute from one deployment. `settleStaggered` starts them 50ms apart. Still concurrent,
deliberately: it is a stagger, not a queue, so a slow trader delays nobody and a pass costs its
slowest member plus the spread rather than the sum.

### One place for the money arithmetic — ✅ DONE

The sale calculation existed twice: in `SaleFacadeService` and in the Mini App's
create form, the second carrying a comment promising it mirrored the first "step for step". That
promise had already failed once — the quote shown and the stake taken disagreed by a cent, which
put a user's whole balance out of reach.

`libs/contracts/src/lib/constants/sale-quote.ts` is now the only statement of it:

- `priceSale(target, rate, percent)` → target, profit, funded, required stake. Both halves
  come out of the snapped target, so `profit + funded === target` exactly.
- `targetForStake(usdt, rate, percent)` → the other direction, for the form. Floors, so the
  derived stake never exceeds what the user typed.
- `isGoalWithinTolerance` and `GOAL_TOLERANCE_KOPECKS` (in `money.ts`) — the one hryvnia every
  goal check allows, shared by the form, the creation check and the running-order compliance
  check.

`CENTS_PER_USDT` and `PERCENT_BASE` moved here from two separate app-local copies.
`CreateSaleReq` moved here from the Mini App's api service, where it was declared locally
despite crossing the wire — the backend DTO now `implements` it.

### The rate can no longer move out from under a submission — ✅ DONE

The market is re-read every five minutes, and the target a user is told to set as their jar's
goal moves with it. Submitting against a stale quote froze a stake on a target the jar could
never reach: it would sit unfillable until compliance blocked it.

`CreateSaleReq.quotedRate` carries the rate the total was worked out at, and
`isQuoteStillValid` refuses a submission the market has moved out from under. **Judged on the
target, not on the rate** — the rate always differs by something, and refusing on that alone
would reject most submissions for nothing a user could act on. The client renders
`ERRORS.1316`, which tells them the total has changed and to check it against the goal already
set in their bank.

Writing it exposed a flaw in the first attempt, caught by its own test: comparing the recomputed
target against the *submitted* one looks more direct but is wrong, because `targetForStake`
floors twice and so loses about a hryvnia on a round trip even when nothing moved. That spent
the whole tolerance before the market did anything. Both ends now go through the same function,
which cancels it.

⬜ **Two error codes collided when these landed.** `CARD_MISMATCH` was written at 1311, which
`JAR_NOT_ACTIVE` already held, and `RATE_CHANGED` at 1312 against `CANCEL_HAS_OPEN_ORDERS` — so
a card mismatch would have told the user their jar was closed. Nothing could catch it: both
sides type-check, and the dictionaries key on the number rather than the name. They are now 1315
and 1316, and `errors.spec.ts` asserts every code is unique and inside its domain's block.

## 5. Access control — ✅ DONE

All five decorators live in `src/modules/auth`, with `CsrfGuard` → `UserTypesGuard` registered
as `APP_GUARD` in `AppModule`. `UserType` (`TRADER`, `TMA`) is in `src/shared/constants/`.
All 25 endpoints across the 6 controllers carry exactly one access decorator; verified by
booting the built bundle and reading the `RouterExplorer` map. 15 guard tests.

`ExtensionAuthGuard` and `TelegramAuthGuard` are gone — their bodies moved verbatim into
`TraderAuthService` / `TmaAuthService`, both implementing `UserTypeAuthenticator`, which is what
`UserTypesGuard` dispatches to. Adding a scheme now means adding a `UserType` member and an
authenticator, not another per-module guard.

Two deviations from the original plan, both because the plan was inherited from an e-commerce
codebase that had cookie sessions:

- **No `SessionOrApiKeyGuard`.** There are no sessions. Every caller authenticates with an
  explicit header, so credential resolution belongs in `UserTypesGuard` itself.
- **`CsrfGuard` is inert today, deliberately.** CSRF requires *ambient* credentials — cookies.
  A cross-site attacker cannot make a browser send `x-api-token` or `x-tma-init-data`, so there
  is nothing to forge. The guard enforces only when a `csrf-token` cookie is present, which is
  never. It exists so that adding cookie auth later does not mean retrofitting CSRF protection
  and exemptions onto live endpoints.

Behaviour was preserved endpoint-for-endpoint. The two that are not `@UserType*`:

| Endpoint | Decorator | Why |
|---|---|---|
| `POST /extension/auth` | `@Public()` | Establishes the trader — a first-time token has no row yet, so authenticating up front would reject every new user |
| `GET /api/tma/deposits/config` | `@Public()` | Was already unguarded; returns wallet address and rate |
| `POST /webhook/trader` | `@Public()` + `@SkipCsrf()` | Transacto is a server, not a user; identity comes from the HMAC signature that `WebhookSignatureGuard` still checks |

`WebhookSignatureGuard` stays a module-local `@UseGuards` on purpose: it is a signature scheme,
orthogonal to user-type auth, and folding it into the global chain would put webhook-specific
logic in everyone's request path.

> Note: `@UserTypeBuyer()` / `@UserTypeAdmin()` from the original inherited docs are replaced
> by `@UserTypeTrader()` / `@UserTypeTMA()` — this project has no buyers or admins.

## 6. Inherited claims — verified during the Nx migration

The original rules file was copied from an e-commerce codebase ("FlashKey"). Findings:

| Claim | Reality | Action |
|---|---|---|
| `src/common/**` | Does not exist; it is `src/shared/**` | ✅ corrected in docs |
| HTTP adapter is Fastify | **Express** — `@nestjs/platform-express`, no `FastifyAdapter` anywhere | ✅ corrected in docs |
| Global `ValidationPipe` with `whitelist`/`forbidNonWhitelisted`/`transform` | **Configured** via `APP_PIPE` in `app.module.ts` | ✅ correct as documented — an earlier note here claiming otherwise was wrong; `main.ts` imports `ValidationPipe` without using it, which is what caused the misreading |
| 10 MB body limit | Not configured — only `rawBody: true`, so Express's 100kb JSON default applies | ⬜ set an explicit limit or drop the rule |
| Throttler defaults + `@Throttle()` | Not configured | ⬜ add or drop the rule |
| Session cookie (HMAC-SHA256) auth | Not present, and not wanted — all auth is header-based | ✅ resolved in §5; rule dropped |
| `MongooseLeanVirtual` global plugin | Not installed. The "always a plain object" invariant holds only because queries call `.lean()` explicitly | ⬜ install the plugin, or restate the rule as a `.lean()` convention |

> Validation is enforced. Note the two consequences of `whitelist` + `forbidNonWhitelisted`:
> an undecorated DTO property is silently stripped, and an unexpected property in a payload is
> a 400. Audited at the time of writing — every `@Body`/`@Query` target carries decorators, and
> every client payload matches its DTO exactly. `webhook.controller.ts` binds `@Body()` to the
> `OrderWebhookPayload` **interface**, which has no runtime metatype, so the pipe skips it
> entirely: that endpoint is unvalidated. Converting it to a DTO class is worthwhile since it
> is a public webhook.

- Example domains in the runbook (`Order`, `PaymentProvider.ROZETKA`, promo codes, cart) are
  illustrative only — they are not part of this codebase.

## 6b. Lint — ✅ DONE, `nx lint` is green

All 17 errors fixed (16 api + 1 extension). Two were not style at all:

- **`order-polling.service.ts` had two empty `if (order.card_id) {}` blocks** on the paid and
  cancelled webhook paths. Old-repo history shows they used to call
  `handleExternalStatusChange(...)`, deleted wholesale by `dd8bf7c` (2026-07-11) when order
  tracking was modularised. The behaviour is not missing — terminal history is now recorded by
  `TerminalHistoryService` reacting to `order.state_changed` — so the blocks were dead leftovers,
  now removed.
- **`order-matcher.service.ts` read the DB and threw the result away**:
  `const updatedPendingOrders = await getPendingOrdersForCard(cardId)` was never used, one query
  per perfect match. Removed, along with an unused `resolvedAlerts` destructure and an unused
  `fuzzyResolvedAlerts`.

The empty `catch (e) {}` in `proxy-manager.service.ts` now warns with the proxy slot index: the
`try` only builds a masked debug line, but an unparseable URL there means `HttpsProxyAgent` is
about to fail on the same string.

<details><summary>Original list</summary>

The Nx ESLint config is stricter than the old repo's, and it surfaces violations of rules this
project already claims to follow. None are boundary violations — the dependency graph is clean.

| Rule | Count | Note |
|---|---|---|
| `@typescript-eslint/no-inferrable-types` | 6 | redundant annotations like `x: boolean = false` |
| `no-case-declarations` | 4 | `const`/`let` inside a `case` without a block |
| `prefer-const` | 3 | **already a documented rule** — `let` never reassigned |
| `no-empty` | 3 | empty `catch`/block — swallowing errors silently |
| `@typescript-eslint/no-unused-expressions` | 1 | statement with no effect |

All mechanical. Fix them as their own commit so the diff stays separate from behavioural work.
The `no-empty` ones deserve a look rather than a blind fix — an empty catch in a payments
backend is usually a bug, not style.

</details>

## 6c. Nothing was typechecking the backend — ✅ FIXED

`nx build api` runs webpack, which strips types without checking them: a file containing
`const x: number = 'nope'` compiled successfully. Confirmed by planting exactly that and watching
`build` pass while `tsc` failed. Eight real type errors had accumulated behind it:

- `TmaDepositStatus` / `TmaSaleStatus` were re-exported by their `.schema.ts` files but
  missing from the `schemas/index.ts` barrels, so six consumers imported a member that the barrel
  did not export.
- `sale-facade.service.ts` took `bankType: string` and used it to index
  `Record<BankProvider, number>`. Narrowed to `BankProvider`, which is safe because the DTO
  already validates it with `@IsEnum(BankProvider)`.

Fixed, plus a `typecheck` target (`nx typecheck api`) so it cannot regress. Also stripped UTF-8
BOMs from 21 barrel files, left behind by PowerShell during the repository extraction.

The two Angular apps had an *inferred* `typecheck` target from `@nx/js/typescript` that had never
run: it invokes `tsc --build --emitDeclarationOnly`, which fails on an application config with no
`composite`/`declaration`. Overridden with a plain `tsc -p tsconfig.app.json --noEmit`, since an
app has no declarations worth emitting. `nx run-many -t typecheck` is now green for all four
projects. (Angular *templates* are still checked only by `nx build`, which runs ngtsc.)

## 7. Monorepo follow-ups

- `src/shared/interfaces/order.interface.ts` (`TransactoOrderStatus`, `TerminalType`,
  `Currency`, `TransactoOrder`, `OrderWebhookPayload`) describes the **upstream** Transacto
  API. Decide whether any of it is also a contract for our own frontends before moving it to
  `@transacto/contracts`.
- `src/shared/interfaces/` has no `index.ts` barrel, unlike `constants/` and `utils/`.
- `shared/interfaces/` has no `index.ts` barrel — ✅ it does now, and `TmaAuthUser` /
  `TmaAuthenticatedRequest` moved there out of the deleted TMA guard.
- ✅ The `test` target is wired (`@nx/jest:jest` + a `src/*` `moduleNameMapper` mirroring the
  webpack alias). `nx test api` runs.

---

## Webhooks reached the dashboard only through the scraper

Reported as "the backend ignores webhooks entirely": an `order.cancelled` delivery arrived,
logged, and nothing in the extension changed.

The delivery was not being ignored. `TERMINAL_BALANCE_UPDATED` is the only event carrying
`hasPendingOrders` / `pendingOrdersSum` to a terminal card, and it had exactly one emitter —
`TerminalBalanceOrchestratorService.broadcastBalanceUpdate`, called from the scraper and the
matcher. The webhook path wrote the order to Mongo and emitted `terminal.state_changed`, which
writes a history row and nothing else; the history feed is read by the history *page*, not by
the dashboard.

So the pending figure was a side effect of polling:

- `order.created` reached it late — `enqueueOrderForPolling` kicks the loop, so the next pass
  picked it up;
- `order.cancelled` reached it later still — nothing kicks the loop for a cancellation, and the
  loop throttles to 10s once no orders are pending;
- and when the loop was not running at all — terminal disabled, bank erroring, polling stopped
  after a fraud check — it never reached it.

`OrderDbService.emitStateChanged` now emits a second, narrower `terminal.orders_changed`
alongside the history event, and `TerminalOrdersBroadcastListener` turns that into a balance
broadcast in the same request. It contacts no bank: the figures come from whatever was last
observed, and the only thing an order event actually changes is the pending sum.

The two events are kept apart on purpose. One writes a durable audit row; the other refreshes a
number on a screen and must never be able to fail the write — hence the swallowed catch in the
listener.

⬜ **A disabled terminal is deliberately not broadcast.** The client's store *adds* a card for a
balance event whose terminal it does not already hold, and the dashboard only ever holds enabled
ones, so a stale order finally being cancelled would make a switched-off jar reappear out of
nowhere. Widening `TerminalBalanceUpdatedDto` with `enabled` would let the client decide instead.

## Balance and goal did not survive deactivation

The extension showed no balance for a switched-off terminal, and the assumption was that the
figure was stored "somewhere in Redis or Mongo". It was not.

- The `Terminal` schema had no balance or goal at all.
- Both lived only in Redis, under `terminal:state:current:{id}`, with a **one-hour TTL**.
- Every deactivation path — `TerminalsSyncService`, `TerminalErrorHandlerService`,
  `SaleTerminalService` — calls `del(...terminalRedisKeys(id))`, which **deletes them**.

`lastBalance` / `lastGoal` / `lastBalanceAt` now live on the terminal document, written by
`ScraperExecutionService` when a scraped figure actually moves — not on every pass, or it would
be a Mongo write per terminal per 5–10s to store an unchanged number.

**They are display-only, and must stay that way.** They are not the baseline. The baseline is
the fraud detector's reference point and is cleared on deactivation *on purpose*, so a terminal
brought back to life does not compare today's balance against a figure from before it went away
and read an emptied jar as a withdrawal. Reviving that number through this back door would
reintroduce exactly that bug.

⬜ **Terminals disabled before this shipped stay blank.** Nothing was persisted for them and
Redis is long gone. The `history` collection holds a `balance` per row and could backfill it —
but not `goal`, which history has never stored. Deliberately not done: a half-backfill that
shows a balance against no target is its own kind of misleading.

## Terminal search

`GET /extension/terminals/search?q=&limit=` — the only route back to a terminal the dashboard
has dropped, since the dashboard returns live jars plus those with unread alerts and nothing else.

Ranking is the point, not a detail: exact name match, then a fully typed id (card, terminal or
send id), then a name prefix, then a name substring, then anything else — a live terminal ahead
of a dead one within each tier. The exact-name query runs *separately* from the broad one and is
merged in, because the broad query is capped at 200 and ordered by recency: on a large account
the very terminal the trader named could be the row the cap dropped.

`escapeRegex` exists because `$regex` compiles whatever it is given. A jar name containing `(`
would have come back as a 500, and a term of `.*` would have matched every terminal silently.

---

## The webhook 400 that nobody could see

Reported twice, the second time with the log that gave it away:

```
LOG   [WebhookSignatureGuard] 📥 Webhook delivery: event=order.cancelled trader=592 order=1627823 …
DEBUG [WebhookSignatureGuard] Webhook signature verified for trader 592
```

and then nothing. Not the handler's `✅`, not a warning, not an error. The request died between
the guard and the handler.

Two independent faults, and it needed both to be this invisible.

**1. A method-level `@UsePipes` does not replace the global pipe.** NestJS runs global pipes
first, then controller, then method, and every bound pipe runs. The route declared

```ts
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
async handleWebhook(@Body() payload: OrderWebhookReqDto, …)
```

with a comment claiming it "overrides the global pipe for this route only". `AppModule`'s pipe
is `forbidNonWhitelisted: true`, so any property Transacto sends that `OrderWebhookReqDto` does
not declare was a 400 — decided before the lenient pipe was consulted and before the handler was
entered. Verified against a booted app, not reasoned about: `POST` with one extra field returns
`400 property surprise_field should not exist` and the handler is never called.

The body now arrives as `unknown` — which compiles to the `Object` metatype and which
`ValidationPipe` skips — and `parseOrderWebhook` validates it on terms that suit a third-party
payload: strict about the fields we act on, silent about everything else.

**2. There was no exception filter at all.** Nest's built-in one answers the caller and logs
nothing, so *every* rejection anywhere in this app was invisible. `AllExceptionsFilter` now logs
method, path, status and reason, then delegates to `BaseExceptionFilter` so status codes and
bodies are unchanged. Names and paths only — never headers, never the body: the first carries
`X-API-TOKEN` and the second carries card numbers.

**A third fault fell out of fixing it.** `order` was a required DTO field, but `balance.low` and
the appeal events carry no order — so each of those was a 400 too, and Transacto retries a 400.
Deliveries we would have acknowledged and dropped were being redelivered indefinitely. `order`
is now optional; the controller checks for it after deciding the event is one we act on.

### The tests were part of the problem

`order-webhook.req.dto.spec.ts` ran `plainToInstance` + `validateSync` with the *route's* options
and passed twenty-five cases, including the exact production payload — while the live endpoint
rejected the same payloads. It was testing options that were never the ones deciding, and it read
as proof that the endpoint worked.

`webhook.pipeline.spec.ts` boots a real app with the global pipe and filter registered as
`AppModule` registers them, and asks over HTTP. Reverting the handler's parameter to the DTO
turns three of its cases red, which is the check that it is worth having. The DTO spec keeps its
narrower job and now says so at the top.

⬜ **This route is the only one typed `unknown` on purpose, and it is fragile knowledge.** A
future reader "fixing" the annotation back to the DTO reintroduces the bug — the pipeline spec is
the only thing standing in the way. A per-route escape hatch from `forbidNonWhitelisted` would be
better, but pipes receive no execution context, so there is nowhere clean to read such a flag.

---

## The unfillable tail

Transacto will not route an order below ₴300, and a Mini App terminal is created with
`max_turnover` equal to its target. So once a jar is within ₴300 of its goal there is no room
left for an order big enough to exist: the last stretch cannot arrive through the pipeline that
delivered everything before it, and somebody has to pay it in by hand.

An order can now be created asking for the other ending. `SaleRemainderPolicy` is
snapshotted onto the order at creation, next to `profitPercent` and `exchangeRate` and for the
same reason — changing the default later must not change how an order already running settles.

- `WAIT_FOR_TOP_UP` — the default, and bit-for-bit what every order did before this existed.
- `REFUND_TO_BALANCE` — the tail is converted at the order's **own** rate and returned to the
  spendable balance, and the order completes successfully.

The worked example it was specified with: ₴10 per USDT, 98 USDT staked, ₴1 000 target, three
₴300 orders in, ₴100 left → 10 USDT back to the balance, order closed.

### Where each decision lives

**`isRemainderRefundable`** decides *when*. Note the comparison: strictly below the floor, where
`isSaleFunded` allows equal. The two ask different questions and the operator follows the
question — there the gap is money already in the jar, here it is money that has *not* arrived,
and an order of exactly ₴300 is one the pipeline can still route. `delivered <= 0` is excluded
too, or an order whose whole target happened to sit under the floor would refund itself the
instant it was created.

**`settleSale`** decides *how much*, and it is now the single completion ledger — the
normal path goes through it as the identity case. A `WAIT_FOR_TOP_UP` order is deliberately
**not** routed through the delivered figure: such an order only completes when funded, so the
two agree in every real case, but `saleDeliveredFiat` reads zero jar growth when
`openingJarBalance` was never scraped, and an order stored before that field existed would have
had its turnover quietly reduced.

**`usdtCentsForKopecks`** in contracts is the conversion, and the cancellation path was moved
onto it. Two copies of the arithmetic that decides how much money goes back to a user is exactly
what that package exists to prevent.

### Two consequences that are easy to miss

**Turnover and the referral cut move to what actually arrived**, not the target. Turnover drives
the trust ladder; crediting the full figure would raise a user's limits on hryvnia nobody ever
paid, and pay a referrer a cut of it.

**The refunded tail is slightly generous, by design.** The remainder is returned whole, at the
order's rate, including the profit share baked into it — so the delivered portion earns a hair
above the quoted rate. Bounded by `remainder × profitPercent`: under ₴6 at ₴300 and 2%. This is
what the feature was specified as, worked example included; charging the profit back out of the
tail would be arithmetically purer and would make the offer harder to explain than it is worth.

**The refund rounds up, not to nearest, and that is what makes the guarantee exact.** A cent of
USDT is worth about half a hryvnia. Rounding the tail conversion to nearest shaved up to half a
cent off what the user was owed — noise on a ₴4 000 order, and on a ₴1 tail *larger than the
profit share inside the tail*: the realised return measured 1.998% against a quoted 2%.
`CentRounding.UP` costs us at most one cent and removes the class of problem rather than the
instance. The cancellation path deliberately keeps `NEAREST`: there the same conversion produces
what is **taken** from the user, and rounding up would take more.

A property test sweeps every rate, stake and tail the rule can fire on — about 127 000 orders —
and asserts three things on each: the realised return is never below what a full fill of that
same order would have given, the user never ends up with less than they paid, and the split
accounts for the whole stake to the cent.

### The in-flight guard

Before a tail is written off, `findUnsettledByCard` must come back empty. The arithmetic says no
order that small can exist — but one raised while there *was* room can still be unsettled, an
appeal above all, and by the time it resolved the sale would be closed, its tail
refunded and its terminal retired. The user would keep both. The same check the cancellation
path makes, for the same reason, at the one moment an order closes.

Funded is checked before refundable, deliberately: a jar that actually reached its target
settles as a full fill with no refund at all, whatever policy the order carries. Asking in the
other order would refund a tail that had already been paid.

⬜ **The `₴300` floor now has three consumers and one home.** `DEFAULT_MIN_ORDER_KOPECKS` moved to
contracts because the Mini App has to *name* it to the user, and `SaleConfigResponse`
ships whatever the server is actually configured with. A client quoting a threshold the server
no longer uses would be describing a product that does not exist.


### The quoted percent is not exactly the delivered percent, and never was

Measuring the above turned up something older and unrelated to the tail. On a **fully filled**
order at ₴46.52 per USDT, 245 of 491 order sizes return slightly less than the quoted 2% — worst
case 1.89%, on the smallest order the product accepts.

It is whole-hryvnia quantisation of the target, not a defect in any calculation. The target is
the number the user types into their bank as the jar's goal, so it must be a whole number of
hryvnia, and `targetForStake` floors rather than rounds — deliberately, because rounding up puts
the derived stake above the USDT the user actually typed, which is the bug that once made a full
balance unspendable.

**The absolute shortfall is bounded by roughly one hryvnia** — at most ₴0.71 across the whole
sweep — and lands in the user's favour about as often as against them. It shows up as a large
*percentage* deviation only on the smallest orders, where ₴0.50 is a tenth of a percent of a
₴474 target.

⬜ Not changed. The only way to remove it is to stop flooring the target, and every alternative
either quotes a stake above what the user typed or gives banks a goal in kopecks that nobody can
enter. Worth stating out loud rather than leaving as folklore: **"+2%" is the quoted rate, and
the delivered figure sits within a hryvnia of it.**

---

## The Transacto API now has a contract, not a set of guesses

Everything the Trader REST API sends and accepts lives in one file:
`src/shared/interfaces/transacto.interface.ts`. `order.interface.ts` and
`terminal.interface.ts` are gone into it — orders, credentials, appeals, the profile, the error
codes and all three outbound webhooks are one third party's surface, and splitting them made it
hard to see what we had and had not covered.

Three response envelopes were **wrong**, not merely loose. `credentials_list`, `orders_list` and
the action endpoints were typed as `{ status: string, … }`; the API answers `{ success: true, … }`
and the list endpoints also carry `count`/`limit`/`offset`. Nothing broke, because every call
site reached straight past the envelope for `.credentials` or `.orders` — which is exactly the
kind of thing a type is supposed to catch and this one could not.

What else changed shape:

- `getTraderProfile` returned `unknown`. Both call sites cast it, and one of them had declared
  its own `TransactoProfileResponse` that the other did not know about. It now returns
  `TransactoProfile | undefined`; the local interface is deleted.
- `createCredential` and `updateTerminals` took inline anonymous objects covering a fraction of
  the documented fields, and `createCredential` cast its own body to `Record<string, unknown>` to
  get past that. Both take the real request types now.
- `TransactoExecuteError`, a two-member `as const` of codes 107 and 108, is replaced by
  `TransactoErrorCode` — all twelve the API defines, each with the consequence in its doc
  comment. `OrderExecutionResult.errorCode` is that enum instead of `number`.
- `Currency` is `TransactoCurrency`. In a codebase counting hryvnia kopecks and USDT cents, a
  type called `Currency` reads like it might mean one of ours.
- `OrderWebhookPayload['order']` is `TransactoWebhookOrder`, a name of its own — the delivery is
  genuinely narrower than `TransactoOrder`, omitting `receiver_name`, `receiver_bank`,
  `customer_name` and `is_test` (that last because it can only ever be 0: a test order produces
  no webhook at all).
- `OrderWebhookReqDto` now `implements Partial<OrderWebhookPayload>` and `WebhookOrderDto`
  `implements TransactoWebhookOrder`, so the validated shape and the wire shape cannot drift.
  `Partial` is deliberate: three of the four documented-as-required fields have each, at some
  point, cost us real deliveries by being required here.
- `credentials_delete` is **typed but has no client method, deliberately** — see the section on
  it below.
- `AppealWebhookPayload` and `BalanceWebhookPayload` are typed. We receive and sign-check both
  and act on neither; an untyped payload is one nobody can reason about when that changes.

## `name` on a new credential was our own identifier

`credentials_create` takes `name`, which the API documents as the receiver — it comes back on
every order as `receiver_name`, and it is what a payer is shown as the person they are paying.

We were sending `TMA-885140`. A comment in the facade asserted that the telegramId "rides in
`name`, which is what that field is for", and that was simply wrong about somebody else's API.
A payer looking at an internal code where a name should be has been given a reason to abandon
the transfer rather than trust it.

`resolveReceiverName` picks from four sources, and the order is a claim about how much each is
worth:

1. **What the bank said.** PrivatBank's envelope record names the account it will pay into,
   masked to a surname and an initial — "Петренко І.". Authoritative, because the bank cannot
   disagree with itself.
2. **The Telegram profile name**, for Monobank and PUMB, which disclose no owner. A guess, and
   knowingly so: it names who *created* the order, and the jar may belong to somebody else.
3. **The Telegram username**, for a profile with no name set.
4. **The old identifier**, so the field is never empty — refusing to create a terminal over a
   cosmetic field would cost a user their order.

The bank's answer is deliberately not reformatted to match the others, or the two would become
indistinguishable: "Петренко І." is a bank's statement about an account and "Роман Петренко" is a
display name, and only one of them has been checked by anyone.

The correlation the old identifier gave an operator is not lost: `terminal_name` is
`TMA-<publicId>`, and the public id resolves to the order and so to the user. The chosen name was
also stored on the order as `receiverName`, so support could answer "what name did the payer see?"
without going to ask Transacto. Nothing ever rendered it, and a person's name held forever for a
question no screen asked is the wrong trade: it is no longer written, and
`0006-forget-receiver-names` removed the copies. The terminal holds the name and is where it is read.

### Monobank names its owner too

Masked the other way round from PrivatBank: a first name and a surname initial, "Іван П."
against "Петренко І.". Neither is normalised to match the other, because the difference is the
bank's and not ours to smooth over.

**It arrives on the handshake we already make.** `send.monobank.ua/api/handler` — the call that
maps a share link's `sendId` to the long `extJarId` — returns `ownerName` along with the goal,
the status, the jar's IBAN and Monobank's own per-payment limits. It costs no extra request.

That was not the first answer. The jar's public record at `api.monobank.ua/bank/jar/<extJarId>`
also carries `ownerName`, and a second call to it was written and tested before the handshake's
real response was captured — a round trip that bought nothing. Calling both endpoints for real
is what settled it, and is why the rule now says to capture the contract rather than reason
about it.

The gap in both cases was the same: `MonoRawResponse` declared `amount` and `goal` and covered
everything else with an index signature, so the owner's name arrived on every single scrape and
nothing in the codebase knew it existed.

⬜ **PUMB is the last one left.** Its moneybox resolves by following a redirect, which reveals
nothing about the box, so a PUMB terminal's receiver name is still the order creator's Telegram
profile: a plausible guess, not a verified fact. Whether `payhub.com.ua` exposes an owner at all
is unexamined.

⬜ **Monobank still discloses no card number.** The jar's own "Номер картки Банки" appears on the
share screen and in no public record, so the card-mismatch check that PrivatBank gets cannot run
for Monobank — the user types it and nothing verifies it.


---

## The bank APIs have a captured contract now

`src/shared/interfaces/bank-api.interface.ts` holds every shape Monobank, PrivatBank and PUMB
answer with. Each was captured from a live call against a real jar and envelope — keys and types
printed, values masked, because these payloads carry card numbers and IBANs.

`bank-response.util.ts` keeps the adapters and no longer declares the shapes: contract in
`interfaces/`, arithmetic in `utils/`. The same split `transacto.interface.ts` follows.

What the capture turned up:

- **Monobank's jar handshake returns twenty-two fields**, of which four were being read. Among
  the rest: `ownerName`, the jar's `iban`, and `config.minAmount` / `config.maxAmount` — the
  bank's own per-payment limits, which nothing consults.
- **PrivatBank's `pubinfo` returns sixteen**, of which eleven were declared. `goalDate`,
  `daysToGoal`, `img`, `task_id` and `status` were not.
- **`fetchPrivatZipLink` returned `unknown`** and `initPrivatSession` read
  `response.data?.data?.xref` off an untyped body. Both are typed now, including the fact that
  `data.value` is a JSON string whose `payload` is sometimes a JSON string again.
- **`fetchPrivatBalance` ended `return response.data ? response.data : response`**, on a comment
  about responses that "arrive already unwrapped". None does — the success interceptor is the
  identity and a live call answers `{ task_id, status, data }` every time. It type-checked only
  because an `AxiosResponse` also has a `.data`, so handing one back where the envelope was
  expected lined up by coincidence. Removed.
- **The same field differs between two endpoints of one bank.** Monobank's `currency` is the
  string `"980"` on the handshake and the number `980` on the jar record; the jar title is `name`
  on one and `title` on the other; `jarId` on the record is the *short* id, not the long one the
  endpoint is addressed by.

⬜ **PUMB is the one bank still guessed at.** `PumbRawResponse` declares the three fields the
adapter reads and keeps its index signature, with a comment saying the contract is unverified —
which is what an unverified contract should look like. Capturing it needs a real moneybox.

⬜ **PrivatBank's session init returns `data.uiConfig`**: several hundred fields of banners,
tariffs, card artwork and FAQ copy in three languages, none of which describes an envelope. Left
as `Record<string, unknown>` and named as such. Deliberately opaque is not the same as
undeclared, but it is the one place in these files where a payload is not enumerated.

---

## An order settling wrote two history rows

Reported from the extension's history for `TMA-8F4808RP`: order #1630836 produced two entries at
the same second — "⚡ Order #1630836 confirmed manually (500,00 ₴)" immediately under
"✅ Order #1630836 fully matched".

Nobody confirmed anything manually. The `order.paid` webhook that produced the first row fired
**because of our own `orders_execute` call**, and it arrived before our own database write.

The sequence, all inside one scrape pass:

1. `OrderMatcherService` matches the ₴500 delta and calls `orders_execute`.
2. Transacto executes it and fires `order.paid` — a fresh inbound HTTP request to us, racing the
   local write that has not happened yet.
3. `handleOrderPaid` wins: `markCompleted(EXECUTED, ADMIN_PANEL)` succeeds against a still-PENDING
   order, and `emitStateChanged` announces `ADMIN_PANEL` — one of the three states it treats as
   worth a history row. **Row one: "confirmed manually".**
4. The matcher's own `markCompleted` then matches nothing (`status: { $ne: EXECUTED }`) and
   returns `false`. **The return value was discarded**, so the matcher pushed its history event
   regardless. **Row two: "fully matched".**

The numbers in the screenshot corroborate it exactly: the "manual" row shows the jar at ₴0 and
expected falling ₴960 → ₴460 (the order left the pending pool before the scrape had written the
new balance), and the "matched" row shows ₴500 with expected back at ₴960 (the baseline moved).

### The fix

`markCompleted` is *already* the atomic gate that decides which path settled an order — its
`{ orderId, status: { $ne: status } }` filter means exactly one caller gets a document back. The
webhook path has always respected the answer. The matcher never read it.

Both matcher branches now record a history event only when they actually settled the order.
Everything else still runs either way — the payer's hryvnia is in the jar whoever wrote it down,
so the baseline still advances, the alerts still resolve and the balance is still broadcast.

`TERMINAL_ORDERS_EXECUTED` is derived from that same list and so falls silent in the raced case,
which is correct rather than a gap: the path that did settle the order announces it through
`terminal.state_changed`, the Mini App's listener already treats an `ADMIN_PANEL` settlement as
money arriving, and `creditedOrderIds` dedupes whichever reaches it first. The two signals were
designed to be complementary; this makes the history feed agree with that.

### A second, quieter bug found on the way

The perfect-match branch called `markCompleted(orderId, EXECUTED)` with **no execution reason**,
while the fuzzy branch beside it passed `FUZZY_MATCH`. So every cleanly matched order was stored
with an empty `executionReason` — the `FULL_MATCH` label existed only on the history entry, never
on the order itself. In the race above it was worse than empty: the order kept the `ADMIN_PANEL`
the webhook wrote, permanently recording that a human had confirmed it.

⬜ **The window is closed by gating, not removed.** The matcher still calls `orders_execute`
before marking locally, so the webhook can still win the race — it simply no longer produces a
duplicate row. Marking first would remove the race outright, but a non-108 failure from
`orders_execute` currently leaves the order PENDING to be retried on the next scrape, and
marking first would need a compensating rollback to keep that. Not worth the risk on the money
path for a cosmetic duplicate.

---

## What a completed sale leaves behind

Six changes, all from one report: a sale that closed at ₴850 of a ₴1 000 target still
looked live, still asked for a top-up, and left no trace of having finished.

**The terminal is now capped as well as switched off.** The credential is created with its
turnover limited to the order's target, so an order that closes short leaves headroom behind it
— ₴150 in the reported case. `disable` takes the settled figure and brings `max_turnover`,
`max_turnover_daily` and `limit_by_day` down to it, in the same `credentials_update` request that
clears the `enabled` flags. All three together, because they were set together at creation and
the lower of them wins anyway. Omitted entirely for a cancelled or blocked order: that is a
teardown, not a completion, and rewriting its limits would state something about the money that
is not true.

**"Jar almost full" no longer fires on an order that refunds its remainder.** The warning exists
to tell a trader the pipeline has run out of room and the last stretch is theirs to pay in by
hand. An order set to refund its tail closes itself at exactly that moment, so the alert landed
on the same scrape that completed the order and asked for an action that was already
unnecessary. `BalanceProcessorService` reads the owning sale — through the `-db` service,
because the Mini App depends on this module and reaching the other way would close a cycle — and
only when the alert would otherwise fire, which is rare. A failed lookup still warns: suppressing
one on an error would hide the very thing the alert is for.

**The terminal history has a closing entry.** `SALE_COMPLETED` joins
`TerminalHistoryAlertType` next to `ALERT_RESOLVED` — neither is an alert, and that channel is
the history's one place for "something happened to this terminal that was not an order changing
state". Both remainder policies reach it at the moment each actually finishes, because both
routes into completion come through `completeSale`. Before this the feed simply stopped
after the last match, which reads the same as a scraper that died.

It is emitted with `emitAsync` and awaited — the only emit on that channel that is. The teardown
immediately after clears the terminal's Redis keys, and the history writer reads the jar's
balance from exactly those, so a fire-and-forget emit would race the deletion and file the
closing entry against a balance of zero. `TerminalHistoryService` swallows its own failures, so
awaiting cannot turn a history problem into a failed completion.

### On the Mini App

The status page shows the rate the order was priced at and the USDT it consumed, and states its
remainder policy on the order card rather than only under the progress bar — that card renders
from the order itself and is on screen from the first paint, while the progress card waits for a
snapshot. The dashboard's history rows carry the policy as a badge, so the two kinds are
distinguishable without opening each one.

`TmaSale` gained `exchangeRate` and `frozenUsdt` on the wire. Both were already on the
document and already being returned; the contract simply did not declare them.

### One thing checked and found already correct

Every balance change the scraper observes writes its own history row: `updateCurrentState` emits
only when the figure actually moved, `TerminalHistoryService` writes one row per event, and
`create` does no deduplication or merging. ₴100 followed by ₴150 ten seconds later is two rows.

The one case that cannot produce two rows is two payments landing between consecutive scrapes —
the bank is asked every 5–10 seconds and reports a balance, not a ledger, so two arrivals inside
one interval are indistinguishable from one arrival of their sum. That is a property of polling a
balance, not something the history code could fix.

---

## A finished sale kept its terminal on the dashboard

Reported from a screenshot: a completed order's jar sitting under **ACTIVE JARS**, badged
DISABLED, with "Jar Almost Full — only 150,00 UAH left" beneath it, on an order that had already
closed at ₴850 and refunded the rest.

Three separate faults, two of them introduced by the fix before this one.

**Nothing resolved the alert when the order ended.** `TERMINAL_FULL_WARNING` asks a trader to pay
the last stretch into a jar by hand. Once the order is over nobody ever will — and nothing was
left to clear it either: the terminal is switched off in the same breath and is never scraped
again, so `checkJarFullWarning`, the only thing that resolves one, never runs. The alert stayed
pending for good, and the dashboard deliberately keeps a disabled terminal on screen while it has
an unread alert. `SaleTerminalService.disable` now clears it, on every ending.

**Only that one type.** An unrecognised deposit, an ambiguous one, a fraud suspicion or an order
still awaiting confirmation in the cabinet all want a human *after* the order ends too; clearing
those on teardown would hide them.

**Suppressing the warning was not the same as clearing it.** The previous change stopped raising
one for an order that refunds its remainder, but the resolve loop above it only fires when the
figures move or the jar stops being full — and neither happens on a jar sitting at its goal. A
warning raised before the order's policy was known would have stayed pending. It is resolved
explicitly now.

**"balance unknown" was printed beside a balance.** The archived stamp fell back to that label
whenever `balanceAt` was missing — and on the dashboard path it was *always* missing, because
only the search mapper ever set it. So a disabled terminal pinned to the dashboard by an alert
rendered "balance unknown" in the corner with ₴850.00 next to it.

Two things were wrong and both are fixed: the dashboard row now carries `balanceAt` (from
`lastBalanceAt` when the jar is not being scraped, which is exactly the case that needs it), and
the stamp no longer makes a claim about the balance when what it is missing is the date. It shows
the date or nothing. The claim about the balance lives on the balance, where `hasKnownBalance`
already renders a dash.

---

## One owner for taking a terminal out of service

`TerminalDeactivationService` in `src/modules/terminal/services/` is now the only thing that
stands a terminal down. Three call sites used to do it, each slightly differently, and only one
of the differences was a decision:

| | Transacto | alert | Mongo | Redis |
|---|---|---|---|---|
| sale teardown | ✓ | ✓ | ✓ | ✓ |
| scraper error handler | ✓ | ✗ | in the **same `try`** | dead jar only |
| terminals sync | — | ✗ | ✓ | ✓ |

**Two of those were bugs.** The scraper's error handler wrapped the Transacto call and the local
write in one `try`, so a Transacto hiccup skipped the Mongo write and left the terminal enabled
here — with the scraper polling a credential nobody would ever route to again. And it cleared
Redis on a dead jar but not on a fraud, so a fraud teardown left its baseline behind: a terminal
re-enabled later compared today's balance against a figure from before it went away, read an
emptied jar as a withdrawal, and disabled itself for fraud all over again.

**The third difference was intentional and survives** as an optional `apiToken`. The terminals
sync stands down a credential that has vanished from `credentials_list`; there is nothing left
upstream to switch off.

The five steps and their failure semantics are the service's, not each caller's. Everything
upstream is best-effort and logged; **the local writes always run.** A terminal disabled here but
still enabled on Transacto keeps routing payers to a jar nobody watches — bad, and visible in the
log. A terminal disabled on Transacto but still enabled here is worse: the scraper polls a dead
credential forever and nothing says why.

Each caller now only decides *when*, and supplies what only it knows — which token, and what the
order settled for. `TerminalStateCacheService.clearTerminalState` is deleted: it was the scraper's
own copy of the Redis half and is now unreachable.

## `terminal_is_active` cannot be set, and archiving is not the answer

Transacto returns `terminal_is_active` and `terminal_is_archived` on a credential and accepts
**neither** on the update endpoint — `CredentialsUpdateRequest` lists the fields it takes, and
anything else answers `error_code 105`. Sending it there would not set the flag; it would fail the
whole teardown.

`credentials_delete` would set it, by archiving the credential. **It is deliberately never
called, and there is no client method for it.**

Archiving cannot be undone: an archived credential has to be created again, with a new `card_id`
and a new `terminal_id`, which invalidates every reference to it. Standing a terminal down with
`enabled: 0, enable_orders: 0` is reversible — a trader flips it back in the cabinet and the next
terminals sync reads the flag and revives the local row.

That reversibility matters most on the path most likely to be wrong. The fraud check fires on
**any** decrease in the jar's balance, down to a kopeck, and what it produces is a *suspicion*
raised for a human to review. Destroying the terminal before that review has happened takes the
reviewer's options away before they have looked at anything — and it buys nothing, because
`enabled: 0` has already stopped payers being routed there.

So `terminal_is_active` stays `true` on a disabled terminal, on purpose. The type stays declared
because this file is the Transacto contract and describes the whole of it: an endpoint left
undeclared reads as one nobody has looked at, which is a different thing from one that was looked
at and ruled out.

---

## The USDT rate now comes from Transacto, not Binance

We priced against a market our counterparty does not settle on. Binance's `USDTUAH` ticker said
46.41 in the same minute the Transacto panel said 44.91 — about 3% — and that gap was ours to
absorb in whichever direction it moved. The panel publishes the price Transacto actually quotes,
so `ExchangeRateService` reads that instead.

**Taken as given, with no margin.** `EXCHANGE_RATE_MARGIN_PERCENT` and its 0.75% default are
deleted rather than defaulted to zero: Transacto's figure already carries their spread — that is
what the 3% below Binance *is* — so shaving ours off the top would take it twice. Everything else
about the service is unchanged: kopecks, a 5-minute Redis cache, and a throw rather than a
fallback, for the reason `ERROR.EXCHANGE_RATE.UNAVAILABLE` already gives.

Practical consequence: the quoted rate drops ~2.5% against what the old Binance-less-margin path
produced. That is the point of the change, not a side effect, but it is a real move in what users
are credited per USDT.

### Why the panel needed its own client

`GET /panels/current_rate` is the admin panel's own API. It has no published specification, it
**refuses the `X-API-TOKEN`** every other Transacto call uses, and it authenticates with a session
cookie. So `TransactoPanelApiService` is a separate service from `TransactoApiService`, in a
separate module with a separate axios instance — and the separation is load-bearing:

**An unauthenticated read answers `302 → /login`, not `401`.** A client that follows redirects
receives `200 text/html`, eleven kilobytes of login page, and reads `rate` off it as `undefined`
— a failure wearing the costume of a success, immediately upstream of arithmetic on other
people's money. `TransactoModule` follows up to five redirects, which is correct for the Trader
API and catastrophic here. `TransactoPanelModule` pins `maxRedirects: 0` on the client rather
than on each call, so a method written later inherits it without reading this. That property has
its own spec: flip it to `5` and the suite goes red.

Every shape in `transacto-panel.interface.ts` was captured from live calls, since there is
nothing to read. Worth knowing:

- `remember_token` alone authenticates — presented with no PHP session it is accepted and a fresh
  `PHPSESSID` comes back — so a login is needed roughly monthly, not per request. It is not
  rotated on use, and several issued to one account stay valid together, so replicas do not evict
  each other.
- The token is held **in memory only**. Persisting it would save one POST per restart in exchange
  for a thirty-day credential at rest in Redis.
- The body carries a leading space before the `{`. Harmless to `JSON.parse`, fatal to anything
  comparing the body as a string.

### What is deliberately not known

⬜ **The body of a failed login has never been observed.** One wrong password against the
production account risks locking the trader the whole Mini App runs on. So authentication is
judged by whether a `remember_token` came back, not by the `{"status":"ok"}` body — the cookie is
the thing actually needed, and its absence is the honest test for every failure mode including
unseen ones. `TransactoPanelLoginResponse` says so in place of guessing.

⬜ **Thirty days is the cookie's claim, not a guarantee.** One token was seen refusing within
minutes of issue, for a reason never established. The `302`-then-relogin path is what makes that
a non-event; with the 5-minute cache it costs at most one extra login per cache window.

⬜ **2FA is off on the service account and the code assumes it.** The panel accepts an empty
`2fa_code`. If it is ever switched on, the login breaks and needs a TOTP secret in the
environment.

New environment variables — **these must be set in production before deploying**, or no rate can
be quoted at all: `TRANSACTO_PANEL_BASE_URL`, `TRANSACTO_PANEL_EMAIL`, `TRANSACTO_PANEL_PASSWORD`.

---

## Trust levels ration parallelism, not order size

A level used to cap the size of a single sale — 500, 1000, 2000 USDT. That restrained
nothing worth restraining. An order is already bounded by the stake frozen against it, so the cap
only ever refused users who had the balance to back what they asked for, while somebody running
ten small orders at once passed unnoticed. Parallelism is the thing worth rationing, because each
open order is a live terminal we are answering for.

So `TRUST_LEVELS` now carries `maxParallelOrders` — **1 at NEWBIE, 3 at EXPERIENCED, 5 at PRO** —
and nothing about amounts. The turnover thresholds are unchanged. `ERROR.SALE` 1302 is
retired in place, with 1317 (`PARALLEL_LIMIT_REACHED`) and 1318 (`CREATE_IN_PROGRESS`) added.

`TRANSACTO_MIN_ORDER_KOPECKS` is untouched: it is Transacto's minimum order, not a trust level,
and the "return anything under ₴300" remainder policy is built on it.

### A slot is held by BLOCKED too

`SLOT_HOLDING_STATUSES` is `OPEN_STATUSES` plus `BLOCKED`, and the two lists stay separate rather
than one being widened. `OPEN_STATUSES` guards `blockIfOpen`, `cancelIfOpen` and `completeIfOpen`
— putting `BLOCKED` in there would let a blocked order be completed or cancelled afterwards.

A blocked order is not open: its terminal is stopped and nothing watches it. But its stake stays
frozen and it was stopped for breaking a rule of the scheme, so releasing the slot the instant an
order is blocked would make being blocked cost nothing. Counted rather than tracked in a counter,
because a counter drifts the first time an order ends by a path that forgets to decrement it —
and the failure mode of drift is a user locked out of the product with no visible reason.

### The check is a read-then-write, so it is locked

Counting slots and then inserting the order is exactly the shape two requests in the same instant
both pass. At NEWBIE, where the allowance is one, that is the difference between a limit and a
suggestion — and a double-tap is enough to trip it.

`RedisKeys.Sale.createLock(telegramId)` is taken with `SET … PX NX` and held across the
count, the freeze and the insert: three steps that are one decision. The section is deliberately
short — two Mongo round trips and no upstream calls — and is released in a `finally` before
Transacto is asked for a terminal, so one user's slow provisioning never blocks their next order.
The TTL is only a backstop for a process that dies mid-section.

A caller that cannot take the lock gets 1318 rather than waiting. That is almost always a
double-tap, and refusing the second tap is the right answer to one.

All five guards are mutation-tested — the check, its `>=` boundary, the lock acquire, the lock
release, and `BLOCKED`'s membership — each removed in turn with the suite going red.

---

## Only PrivatBank takes new sales, and it supplies the card itself

Three changes that turn out to be one fact wearing three hats, which is why
`BANKS_DISCLOSING_CARD` is a list in `@transacto/contracts` rather than three separate
conditions: **PrivatBank names the card its envelope pays into, and Monobank and PUMB do not.**

**Monobank and PUMB are closed for new orders.** `SALE_ENABLED_BANKS` is the list, shared
so the picker and the server cannot disagree; the create form greys the tiles out and
`SaleFacadeService` refuses with 1319 before it resolves the link or touches anything. A
greyed tile is a courtesy — the request is trivially assembled by hand, and a Mini App left open
from before the change knows nothing about it. **Creation only**: orders already running on those
banks are scraped, matched and settled exactly as before.

**The card is no longer the user's to type for a bank that discloses one.** The server takes
`dropCardNumber` and discards whatever the client sent — comparing them and then using the
client's value would leave the account resting on a comparison rather than on the bank. A
difference is logged, because the field is no longer editable and so a difference means a stale
or tampered client, but it changes nothing. Where the bank was supposed to name a card and did
not, the order is refused with 1320: there is nothing to fall back to, and accepting a typed
number would put an unverified account into the system through the one route built to make that
impossible.

**The dead-order fraud rule is skipped when the bank named the card.** That rule exists to catch
one thing — a card that does not belong to the jar the link points at — and when the jar named
the card, that cannot be what happened. Three dead orders there are payers walking away, and
blocking would freeze a correctly set-up user's stake for something nobody did wrong. The goal
check is untouched: a user can still set a jar target that does not match.

`cardVerifiedByBank` is read off the **order**, not off its bank: what matters is that this link
actually disclosed a card, not that its bank usually would. It defaults to `false`, so every order
written before the field existed keeps the rule — the safe direction, since an unnecessary check
costs a false positive on a jar nobody could pay into anyway.

All five guards are mutation-tested: the bank refusal, the missing-card refusal, using the bank's
card, the fraud skip, and the enabled-bank list itself.

⬜ **Re-enabling a bank is one line** in `SALE_ENABLED_BANKS`. Doing so brings back a bank
whose orders rest entirely on sixteen typed digits, so the fraud rule matters again for it — which
is why that rule was left in place rather than deleted.

---

## A user can now stop an order that still has payments outstanding

Stopping used to be refused outright whenever anything was unsettled on the terminal
(`CANCEL_HAS_OPEN_ORDERS`, 1312). Now outstanding orders decide *how* the stop happens rather than
whether it may be asked for, and the order takes one of two endings:

- **nothing outstanding** — unchanged: terminal torn down, stake unwound, `CANCELLED`;
- **payments outstanding** — the order moves to the new `CLOSING` status, routing stops, and the
  settlement waits.

### Why the terminal must stay in service

The premise that made this hard is half right. A disabled terminal is invisible to the extension
and to the scraper — but **order statuses keep flowing regardless**, because `OrderSyncService`
polls `orders_list` per *trader* and the `order.paid` / `order.cancelled` webhooks are
trader-scoped too. What is lost by disabling is the *jar*, not the orders.

That loss is the whole problem. The Trader API has **no way to cancel an order** — `orders_execute`
only confirms — so an outstanding order is paid or times out on Transacto's clock. A payer who pays
after we stop scraping sends hryvnia into a jar nobody is watching: the matcher never runs, the
order is never executed, and the sale refunds the full stake while the user keeps the
money. We would pay for the same hryvnia twice.

So `TerminalDeactivationService` grew a second, narrower operation. `stopRouting` sends
`enable_orders: 0` **only** — no `enabled: 0`, no turnover caps, no Redis clear, no
`TERMINAL_DISABLED`. The terminal keeps being scraped, keeps matching payments, and keeps its
state; it simply gets nobody new.

### The trap that would have undone it silently

`TerminalsSyncService.resolveEnabled` reads upstream `enable_orders` **into the local `enabled`
flag**. Setting `enable_orders: 0` would therefore have disabled the terminal on the next sync
pass — one minute later — stopping the scrape and restoring exactly the failure above, with
nothing in the log to say why.

The local `acceptingOrders: false` is what prevents it: the sync treats upstream's flag as our own
doing and leaves the row alone. It is bounded to `enabled === true` and reset by `deactivate`, so
the exception cannot outlive its window and pin a torn-down terminal off for good. **That guard was
the one piece a mutation slipped through on the first pass** — the suite went green without it, and
it now has three tests of its own.

### What settles it

`SaleClosingService`, a 30-second sweep over `findClosing()`. A poll rather than a
subscription: the last outstanding order can close through four different routes, and hanging the
settlement off each would mean four things that must all be right and none of them surviving a
restart in between.

`CLOSING` is in `OPEN_STATUSES`, so a closing order still matches payments, still holds its user's
parallel-order slot, and still completes normally if the jar happens to fill. Compliance skips it
outright — both rules freeze the stake, and doing that to an order the user has already walked away
from would punish them while withholding the refund they are owed.

### The chain that must not break, link by link

Re-verified end to end, because everything rests on it: an outstanding order only ever becomes
EXECUTED when the matcher sees the money land, and the matcher only runs off a scrape. Nobody
checks a jar by hand, so a scrape that stops is an order that never completes — while the jar
still takes the payer's hryvnia.

| Link | Gate | Covered by |
|---|---|---|
| watchdog revives the loop | `find({ enabled: true })` — asks nothing about routing | `scraper-watchdog.service.spec` |
| the loop keeps running | `ScraperExecutionService` stops only on `!terminal.enabled` | unchanged behaviour |
| the sync leaves it alone | the `acceptingOrders` exception | `terminals-sync.service.spec` ×3 |
| the matcher finds the order | `OPEN_STATUSES` includes `CLOSING` | `tma-sale-db.service.spec` |
| the order can finally settle | `cancelIfOpen` accepts `CLOSING` | same |

Two things found while checking, both now fixed:

- **The jar-full warning fired on a closing jar.** `checkJarFullWarning` reads balance against goal
  and knew only about the refunding policy, so a `WAIT_FOR_TOP_UP` order winding down would ask the
  trader to pay the last stretch in — pushing it to completion against the very wish that stopped
  it, with the trader's own hryvnia. `refundsItsRemainder` is now `needsNoTopUp` and covers both.
- **The sweep logged a normal race as a failure.** If the jar fills first, or a second instance
  settles first, `cancelIfOpen` returns null and `settle` throws. Exactly one of them moves the
  money — the other is routine, and is now logged as such.

`orders_execute` is not at risk from `enable_orders: 0`: the API refuses an execute on the order's
*status* (105 covers "a status outside {2, 7, 9}"), and the contract carries no code for a
credential that is not accepting orders. Error 110 says the opposite in fact — a credential cannot
be *archived* while an order on it is awaiting payment, so Transacto expects open orders to outlive
a stand-down.

⬜ **No timeout.** A `PAUSED` order or an `APPEAL` under dispute holds the order open indefinitely,
which is deliberate — money in dispute can still arrive — but it means a sale can sit in
`CLOSING` for as long as Transacto takes. Orders carry a `deadline` we do not store; storing it
would give an upper bound to fall back on.

⬜ **`ERROR.SALE.CANCEL_HAS_OPEN_ORDERS` (1312) is now unreachable.** Left in place rather
than retired, since it is the honest answer if a future ending ever needs to refuse again.

---

## The jar outlives the order, so the user has to close it

An order expires on Transacto's clock; the jar behind it does not. A payer who started late can
land hryvnia in an open jar five or ten minutes after the order died — money nothing matches, which
comes back as an appeal we are out of pocket on either way. Nobody but the jar's owner can close
it, so the only lever available is to make closing it a condition.

**A jar left open now holds the user's sale slot** — after *any* ending, completed or
stopped — **and, for an order they stopped themselves, holds the refund too.** There is
deliberately no timeout and no auto-release: a jar that is never closed is a liability that never
expires, so neither does the wait.

`countSlotsHeldByTelegramId` became an `$or` of two different reasons: an order still running holds
a slot because it is running, and an ended one holds a slot because its jar is open. An order that
never got a terminal is excluded from the second — there is no jar to close, so holding it would
leave the user nothing they could do.

### Monobank never reported a closed jar, because nothing read the field

`MonoRawResponse.closed` was declared — "A closed jar can never receive a payment again" — and read
by nobody. `adaptMonoBalance` returned a hardcoded `status: 'ACTIVE'` on the reasoning that a jar
which answered at all is live. It is not: Monobank keeps answering for a closed jar and says
`closed: true` in the same body.

So **a closed Monobank jar was scraped forever and never retired**, while PrivatBank (`active:
false`) and PUMB (non-`ACTIVE`) both were. That was a live bug before this feature and the exact
bank the risk was raised about. It is the third instance of the same shape the *Third-party APIs*
rules already catalogue: the field was captured correctly and then never wired up.

### What keeps watching, and what ends it

Completion no longer tears the terminal down — `stopRouting` instead, so it stays scraped. The
turnover cap a completion used to pass went with it: it existed to stop a payer being routed into a
jar already paid out, and `enable_orders: 0` says that outright rather than by arithmetic.

The teardown now belongs to the closure itself. `handleDeadJar` is the only place that ever learns
a jar has shut — the scraper is what asks the bank — so it records `jarClosedAt` against the card,
which releases the slot and lets the closing sweep settle. That sweep now requires **both**
conditions: nothing outstanding *and* the jar closed.

A side effect worth naming: because the terminal keeps being scraped until the jar closes, a late
payment is now **seen** rather than discovered from an appeal.

⬜ **A user who never closes their jar is stuck for good**, by design — one slot gone and, if they
stopped early, one stake frozen. `awaitingJarClosure` on the progress snapshot is what makes that
legible on the status page; there is no operator override yet.

⬜ **A completed order's terminal is scraped indefinitely too.** The polling cost of an abandoned
jar is unbounded, and nothing currently reports how many are in that state.

---

## The jar rule was applied to orders whose jars nobody could see

Reported from production: two sales created long ago against one jar showed a limit of
**2/1**, and closing the jar did not bring it down.

`jarClosedAt` — the only thing that releases a slot — is written from exactly one place,
`handleDeadJar`, which runs only inside a live scrape loop. The watchdog revives loops from
`find({ enabled: true })`. Both of those orders ended *before* the jar rule existed, so their
terminals had been retired at completion under the behaviour of the time and sat `enabled: false`.
Nothing was scraping them, so nothing could ever notice the jar closing. **The condition for
releasing the slot was unreachable in principle** — the rule was applied retroactively to orders it
could never be satisfied for.

Two more things were visible from the same spot:

- **Nothing settles a sale whose terminal died.** `handleDeadJar` retires the terminal and
  fails the upstream orders, but leaves the sale open — so an order whose jar dies while
  running sat open with the user's stake frozen for good. That predates all of this.
- The count and any sweep over it had to agree, or the sweep would skip exactly the orders that are
  stuck. `slotHoldingConditions` is now shared between `countSlotsHeldByTelegramId` and
  `findHoldingSlots` rather than restated.

### The sweep asks the bank

`SaleReconcileService`, every five minutes over every order holding a slot. A terminal the
scrape loop still has is skipped — it would learn nothing new. For the rest it **asks the bank
directly**: `BankScraperService.scrape` reads a terminal by id and never consults `enabled`, so a
retired one can still be probed.

- jar reported closed → release the slot for every order on that card, which is what the reported
  case needed: two orders, one jar, both stuck;
- order still open → settle it and return the stake, as `JAR_CLOSED` rather than
  `STOPPED_BY_USER`, because nobody stopped anything and a timeline saying so tells the user they
  did something they did not;
- **jar still open → nothing changes.** Holding that slot is the rule working.

Any other scrape failure — a proxy, a timeout, a bad minute at the bank — is not a closed jar and
must not be read as one: it would release a slot and refund a stake on a blip. It waits for the
next pass.

"Is this jar gone" is now `isDeadJarError`, shared with the scrape loop. The loop retires a
terminal on that verdict and the sweep frees a user's slot on it; two copies would eventually free
a slot whose jar is still taking money.

Five minutes, not thirty seconds: a pass costs one bank request per unwatched jar, and a slot stuck
since a release is not made worse by another few minutes.

The terminal is looked up by `terminalId`, not by `cardId`. A card id does not identify a terminal
on its own — every other path keys one by `{ traderId, cardId }`, which is precisely why the scroll
order stores `traderId` — and the first version of this sweep read the row by card alone. It would
have decided `enabled` from whichever trader's terminal Mongo returned first: probing a jar the
loop already has, or skipping one nobody is watching. Caught by reading the logs, not by a test;
there is one now.

⬜ **This is not a migration and is not meant to be one.** A terminal can fall out of the loop at
any time, and the same trap would close behind it — which is why the sweep is permanent rather
than a one-off backfill.

## Fiat top-ups settle through a panel we can only read as HTML

A Mini App user can now top up with hryvnia by paying one of Transacto's own payouts: they pick
an amount, a payout carrying it is taken in their name, they transfer that sum from their card
to the recipient, and their receipts are uploaded to Transacto's recognition. Their money never
touches an account of ours; what we hand back is USDT at the rate frozen when they reserved.

The whole path runs through `app.transacto.us`, the counterparty's operator UI — a session
cookie, a scraped CSRF token and four HTML tables. It has no specification and no JSON for any
of it. Every shape was captured from a browser and is documented in
`src/shared/interfaces/transacto-panel.interface.ts`; the rules that cost money are in the
`transacto-panel` skill.

⬜ **Two failure shapes are still unobserved, and the code says so rather than guessing.**
Neither blocks the product; both send an edge case to an operator instead of resolving it:

- **`assign_trader` on a payout another trader already took.** The most common real failure —
  two users tapping the same amount — and no capture of it exists. Anything whose `status` is
  not `'ok'` is treated as "that one got away, try the next", which is right for this case and
  indistinguishable from a genuine outage.
- **`confirm_check` for a receipt smaller than the payout.** Large payouts are settled in
  several transfers, so this is an ordinary flow, and what the panel answers mid-way has not
  been seen. Any `ok` is taken as "receipt attached"; coverage is then recomputed from the
  accepted amount rather than inferred from the reply.

⬜ **`checkUrl` is declared on the receipt subdocument and never written.** Transacto files an
accepted receipt in public object storage and names it in the `?ajax_checks` table, which the
reconciler does not read today — so an operator reviewing a top-up cannot open the receipt from
the panel and has to find it in Transacto's own. Backfilling it means one more table read per
reconcile pass and a DB method to attach the urls; deliberately deferred until the partial-check
capture above lands, since both touch the same pass.

⬜ **The book is polled, not pushed.** `payouts_count` makes the poll cheap — the eleven-kilobyte
table is only fetched when the number moves — but a user's screen can still be up to twenty
seconds behind the truth. Reservation reads the book live for exactly this reason, so the cost
of the staleness is a refused tap and never a wrong payout.

