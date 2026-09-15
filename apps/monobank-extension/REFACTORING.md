# Refactoring Backlog — Monobank Extension

Where the current code diverges from [CLAUDE.md](./CLAUDE.md) and
[.claude/skills/angular-structure/SKILL.md](.claude/skills/angular-structure/SKILL.md).

**This is a backlog, not a precedent.** New code follows the rules; existing code listed here
is scheduled for the structural refactor. Don't copy these patterns.

---

## 1. Module layout — ✅ DONE

`app/components/**` + `app/core/{services,models,guards,pipes,state,utils}` is gone. The app is
now `app/{auth,dashboard,terminal,safe-box,layout}/` plus a genuinely small `core/` and
`shared/`, each module lazily loaded from its own `routes.ts`.

`core/` holds three things, all true app-wide singletons: `SessionService`, `SocketService`,
`SocketSyncService`, plus `apiTokenInterceptor`. `shared/` holds one pipe. Nothing else was
allowed in.

## 1b. `AuthService` was not an auth service — ✅ FIXED

It had grown into the extension's whole API client: login and logout, but also
`acknowledgeAlert`, `moveToBox`, `forceMatch` and `getSafeBox`. Every method repeated the same
four lines — read the token, bail if missing, set `X-API-TOKEN`, catch and log.

Split along the module boundaries, with the API/service split from the skill spec:

| Concern | Service | API service |
|---|---|---|
| Session state (`token`, `traderId`, `isInitializing`, `chrome.storage`) | `core/services/session.service.ts` | — |
| Sign in / out / deactivate | `auth/services/auth.service.ts` | `auth.api.service.ts` |
| Alert actions | `dashboard/services/alerts.service.ts` | `alerts.api.service.ts` |
| Terminal load / sync / history | `terminal/services/terminal-loader.service.ts` | `terminal.api.service.ts` |
| Safe box | `safe-box/services/safe-box.service.ts` | `safe-box.api.service.ts` |

The repeated header plumbing became `core/interceptors/api-token.interceptor.ts`. It only fires
for `environment.apiUrl` and never overwrites a header the caller set — which is how login still
submits the token being *tested* rather than the stored one. Both rules are covered by tests,
because an interceptor that attaches a credential to the wrong host is a real leak.

`SessionService` exists separately from `AuthService` so the interceptor can read the token
without depending on the service that performs logins — which injects `HttpClient`, and would
have put the interceptor inside its own dependency cycle.

`safe-box.api.service.ts` also switched to `HttpParams`. The hand-rolled
`'?' + k + '=' + v` concatenation left a trailing `&` and never escaped the search term.

## 2. Three-file rule — ✅ DONE

`main-layout.component.ts` had an inline template; it is now three files like everything else.

## 3. Typing — ✅ DONE

`private timer: any` → `ReturnType<typeof setInterval>`, in both `terminal-card` and
`terminal-history`. The `any[]` alert lists are typed too — see 4b.

## 3b. Duplicated enums inside this repo — ✅ DONE

`OrderStatus` and `OrderExecutionReason` were declared twice, identically, in
`core/models/order.model.ts` and `core/models/ws-contracts.ts`. Both files are deleted and the
types now come from `@transacto/contracts`. `order.model.ts` turned out to be imported by
nothing at all — a pure dead duplicate.

## 4. Enums instead of string literals — ✅ DONE

`terminal-card` compared `'PRIVAT'` / `'PUMB'` / `'MONO'` inline; it now keys a
`Record<BankProvider, [string, string]>` of gradient colours off the contracts enum, so an
unhandled bank is a compile error rather than a silent fallback to the Mono palette.

Polling thresholds `1000` / `25000` became `Polling.TICK_MS` / `Polling.STALE_AFTER_MS` in
`terminal/enums/polling.enum.ts`, shared by both components that had hardcoded them.

## 4b. Alert formatting was stringly-typed — ✅ FIXED

`formatAlertMetadata(alerts: any[], KopecksPipe: any): any[]` took the pipe *class* as an
argument and then ignored it, constructing its own. It now takes only the alerts and returns
`FormattedAlert[]` — the same keys as `AlertData`, with the money fields widened to strings.

That type matters: the formatted amounts are localised strings like `"1 234,56"`, so every
action in `terminal-alerts` deliberately re-reads the *unformatted* alert from the store before
posting an amount back. The old `any[]` hid that distinction completely, and it is one
`alert.amount` away from sending a broken payload.

## 5. Derived state — ✅ DONE

`percent`, `backgroundGradient` and `formattedPendingSum` are `computed()` instead of getters
that read signals.

## 5a. `TERMINAL_ENABLED` carries almost nothing — ✅ FIXED

It used to emit `{ terminalId, cardId }` and nothing else, so a terminal enabled while it was not
already in the store landed as a near-empty card until a balance broadcast or a dashboard refresh
filled it in. It was also never emitted at all, which is why nobody had seen the empty card.

The event now carries a whole terminal, in the same shape a dashboard row arrives in, and
`SocketSyncService` maps it through `toTerminal` — the *same* function the REST payload goes
through. Two mappers for one card is how a live row and a reloaded one come to disagree, and the
disagreement only ever shows up in front of a trader.

`enableOrAddTerminal` merges rather than replaces when the terminal is already on screen. The
event carries the figures the backend last stored; a card already rendered may be holding fresher
ones from a live balance push, and overwriting those would walk the number backwards.

## 5b. Test coverage — improved

18 tests across 4 files (was 3 in 1). The new ones cover the pieces where a mistake is invisible
until production: the token interceptor, the alert formatter, and the history `expectedDelta`
derivation.

`src/test-setup.ts` stubs the `chrome` global — components call extension APIs during
construction (`App` calls `chrome?.i18n?.getUILanguage()`), and under jsdom `chrome` is an
*undeclared identifier*, so optional chaining does not save you: it throws `ReferenceError`
before `?.` is evaluated.

Still uncovered: every component's rendering, and the socket wiring.

## 6. Cleanup — ✅ DONE

- Unused `EventEmitter` import and the leftover `console.log(term)` in `openTerminalLink` are gone.
- `ChangeDetectionStrategy.OnPush` on every component.
- Redundant explicit `standalone: true` dropped.
- `socket-sync.service.ts` had a bare `this.socketService.isConnected;` statement under a
  "Clear store when disconnected (auth token lost)" comment — a no-op, since reading a signal
  outside a reactive context does nothing.

  **Resolved for the revocation case only.** `TRADER_DEACTIVATED` now clears the terminal store
  as well as the session: the server has revoked this trader, so the cards on screen describe
  data the token can no longer read. A plain socket *disconnect* still leaves the last-known
  state visible, which is the right call for a popup that reopens constantly — but it deserves
  a "reconnecting" badge, which does not exist yet. ⬜

## 7. Missing shell folders

- No `src/styles/` partials directory and no `src/fonts/`. Create when first needed.
- `app.scss` is 626 lines of effectively global styles loaded through
  `ViewEncapsulation.None` on `App`. Most of it belongs in `src/styles/` partials, and the
  component-specific parts belong in the components. ⬜

## 7b. Alerts now render from a key, not a server sentence — ✅ DONE

The backend stopped storing `Alert.message` (see the API's `REFACTORING.md §4c`). On this side:

- The alert panel's four-branch `@if` collapsed to one expression —
  `{{ 'ALERTS.' + alert.type + '_DESC' | translate: alert.metadata }}` — because the i18n keys
  are now exactly the enum members. Adding an alert type is a JSON entry, not a template edit.
- `getAlertTooltip`'s six-case `switch` collapsed the same way.
- The `alert.message ||` fallback is gone, and `AlertData.message` with it.
- `formatAlertMetadata` scales `totalDelta` as money but deliberately leaves
  `combinationsCount` alone — it is a count, and dividing it by 100 would render
  "Found 0,03 combinations". Both covered by tests.

Renamed so key == enum member: `UNRECOGNIZED_DESC` → `UNRECOGNIZED_DEPOSIT_DESC`,
`TERMINAL_FULL_DESC` → `TERMINAL_FULL_WARNING_DESC`, `AMBIGUOUS_DESC` →
`AMBIGUOUS_DEPOSIT_DESC`. Added the missing `ALERT_RESOLVED_DESC` and `FRAUD_SUSPICION_DESC` —
`getAlertTooltip` referenced both and neither existed, so those tooltips showed the raw key.

⬜ `terminal-history.component.ts` checks `context.reason === 'FUZZY_LIMIT_EXCEEDED'`, which the
backend never sets. Either emit it in the unrecognized-deposit metadata or drop the branch.

## 8. Hardcoded Ukrainian in `terminal-history` — ✅ DONE

`getEventBadgeText` and `getAlertBadgeText` built ~20 user-facing strings inline, in Ukrainian
only, leaving that view untranslated for two of its three languages. They are now
`HISTORY.ORDER.*` and `HISTORY.ALERT.*` keys derived from `OrderStatus` / `OrderExecutionReason` /
`TerminalHistoryAlertType`, with amounts as parameters — the same key-plus-data shape as the
alerts. Ukrainian copy carried over verbatim; en and ru are new.

The optional amount is appended by the component rather than interpolated: a translation cannot
express "only if present", and parentheses around a number are punctuation, not language.

**Typing the two methods exposed two dead branches**, both hidden while the parameters were `any`:

- `order.paidAmount` exists nowhere in the backend or contracts. The manual-confirmation row
  rendered `(Сплачено: X)` — "paid: X" — using the **ordered** amount, because
  `order.paidAmount ? … : amount` always took the fallback. The label no longer claims a figure
  it never had. ⬜ To show the real amount paid, the backend must persist it on the history
  order event.
- `BALANCE_CONSOLIDATION` is not a member of `TerminalHistoryAlertType` and appears nowhere
  server-side, so its purple badge and label were unreachable. Removed.

## 9. Translation parity — ✅ DONE, and now guarded

All three dictionaries hold the same 88 keys. `ALERTS.FORCE_MATCH_SUBMIT`, `_CANCEL`,
`_ORDER_ID` and `_AMOUNT` existed only in uk and ru, so the force-match form rendered raw keys
in English.

**The §8 migration also broke the history page, and nothing caught it.** The script that added
`HISTORY.ORDER.*` / `HISTORY.ALERT.*` did `json.HISTORY = block`, which *replaced* the subtree
instead of merging into it — deleting `HISTORY.TITLE`, `BACK_TO_DASHBOARD`, six `TABLE.*` keys
and two `TOOLTIPS.*` keys in all three languages. The page then rendered its own key names
(`HISTORY.TABLE.TIME`) to the user. It built, linted, typechecked and passed tests throughout:
a missing translation key is invisible to every one of them.

`src/app/shared/i18n.spec.ts` now asserts, on every test run:

1. all three dictionaries define exactly the same keys;
2. no translation is blank;
3. the keys the history page needs are present;
4. `{{placeholders}}` match across languages — a missing `{{orderId}}` silently drops the number.

Verified the guard by deleting `HISTORY.TABLE.TIME` from `en.json` and watching two tests fail.

---

## Not in scope

i18n stays on **`ngx-translate`** with `src/assets/i18n/*.json` — confirmed, no migration to
`@angular/localize` / `.xlf`.

## 10. Terminal source badge and local filtering — ✅ DONE

Terminals created automatically by the Telegram Mini App now carry a blue **TG** corner flag, and
the dashboard has a type filter (All / TG / Other) plus a search box. Both run entirely on the
client: the dashboard payload is already in memory and arrives in full, so narrowing it needs no
round trip.

Search matches name, bank, `sendId`, `cardId` and `terminalId`, case-insensitively, and combines
with the filter rather than replacing it. "No terminals yet" and "nothing matches this filter"
are separate messages — showing the first when a filter is active reads as data loss.

A terminal with **no** `source` counts as *Other*, never TG. Terminals stored before the field
existed have none until the next sync classifies them, and the badge and the filter must agree
about them.

---

## 9. The search box only ever saw what was already on screen

`DashboardComponent.terminals` filtered `TerminalService.terminals()`, and that store holds the
dashboard payload — live jars plus those with unread alerts. A terminal switched off a week ago
was not in it, so it could not be searched for, and there was no other route to its history.

The box now also queries `GET /extension/terminals/search` (300 ms debounce, minimum two
characters, matching the server's own minimum so the second keystroke of every search is not a
guaranteed 400). While a term is present the grid shows **only** matches — the server's list, in
the server's order, since that is where the exact-name-first ranking lives.

Three things worth keeping in mind:

- **Search results are not written into the store.** The store is the live dashboard; everything
  in it is kept current by socket events. Archived jars dropped in there would stay after the
  search was cleared, with balances nothing will ever update.
- **A hit that is also in the store renders from the store copy.** That one is live; the search
  response is a snapshot from when the request was made.
- **`balanceKnown: false` is not a zero balance.** A terminal disabled before the backend started
  persisting figures has none stored anywhere, and "₴0.00" would claim an empty jar rather than
  an unknown one. The card renders `—` and the progress bar stays at 0.

The empty state now distinguishes three cases, not two: no jars at all, a search still in flight,
and a search that came back with nothing. The middle one used to read as the last.

⬜ The search controls are always rendered now, including for an account with no live terminals —
that is precisely when finding a switched-off one matters. The `@if (hasTerminals())` that used
to wrap them is gone.

---

## 10. Telling the two kinds of Mini App jar apart

A trader needs to know which of their jars will ask them for something. A sale that waits
for its full amount raises "almost full" within one order of its goal, and the last stretch is
theirs to pay in by hand; one that refunds its remainder closes itself and never asks.

The card had no room for a new row, so it did not get one. What it got:

**The corner flag changes colour, not text.** It still reads `TG`, because a glyph does not
survive that size — this was measured rather than assumed. At 0.8rem, rotated 45°, `↩` renders as
a smudge: legible only with the card blown up three times, which is not how anyone reads a
dashboard. Colour survives the downscale. Violet rather than green, because this card already
spends green and red on *health* — the progress gradient, the alert border, the pending badge —
so a green flag would read as "this jar is fine" rather than "this jar is a different kind".

**Only the refunding kind gets a written label, and the asymmetry is the design.** A jar waiting
for its full amount behaves exactly like every terminal the trader created themselves. Labelling
that would put a chip on the majority of cards to restate the default. The self-closing jar is
the one that breaks the expectation, so it is the one worth a word — a muted `↩ решта` chip
beside the goal, which is precisely what it qualifies: this jar does not have to reach the figure
on its left.

**The tooltip carries the sentence** for both, because colour can distinguish but cannot teach.

`remainderPolicy` reaches the client on the dashboard payload and on search results, looked up
once per page rather than once per row — and by the *newest* order on each card whatever its
status, not only an open one. A terminal outlives the order that made it: it stays on screen
while it has an unread alert and is reachable through search forever, and a finished order still
explains what the terminal was for.

---

## A jar can be winding down without being gone

`acceptingOrders` is new on the terminal card, and it answers a different question from `enabled`:
whether Transacto still routes new payers here. The two part company for a Mini App order whose
user has asked to stop while payments are still outstanding — the jar is still scraped, still
matching, still able to receive, and simply gets nobody new.

The card stays on the dashboard with an amber "closing" chip beside the goal, which is the point:
money can still land in that jar. Dropping the row the moment the user tapped stop would hide live
money from the trader. Amber rather than the remainder chip's violet, because this is a temporary
state worth half an eye rather than a permanent property of the jar.

Read as `=== false`, never falsy — the field is absent on a payload older than it, and absent means
routing normally.
