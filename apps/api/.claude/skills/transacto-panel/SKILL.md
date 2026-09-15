---
name: transacto-panel
description: How to add or change a call to the Transacto operator panel (app.transacto.us) — the HTML-scraped session the fiat top-up settles through. Covers what to capture from a browser before writing code, the session and CSRF layer, parsing its tables, and the rules that cost real money if broken. Use when touching anything under modules/transacto, the payout book, receipts, or the fiat deposit path.
---

# Runbook: talking to the Transacto panel

`app.transacto.us` is the operator UI of our counterparty. It is **not** the documented Trader
REST API (`/api/trader`, `X-API-TOKEN`, `transacto.interface.ts`) — it has no specification, it
answers HTML, and it authenticates with a session cookie. It is also the path a Mini App user's
hryvnia takes: payouts are taken, receipts attached and balances credited through it.

Everything already known about its shapes lives in
`src/shared/interfaces/transacto-panel.interface.ts`. Read it first; extend it as you learn more.

---

## Step 0 — Capture it before you write it

**Do not write an interface for a panel call you have not seen.** Ask the user for a browser
capture and wait for it. A guessed shape here is worse than an admitted gap: the gap gets
fixed, the guess gets trusted and settles somebody's money on a field that does not exist.

Ask for, per call:

1. **Request** — method, full URL with its query flags, and the form or multipart fields. The
   panel addresses actions by query flag (`?assign_trader=1&id=…`), which is easy to miss.
2. **The successful response body**, whole.
3. **A failing response body.** The one everybody forgets and nobody can guess. Ask
   specifically: what comes back when the payout was already taken, when the receipt is
   refused, when the session died.
4. For a table: the **fragment** endpoint (`?ajax_new_payouts`, `?ajax_active_payouts`,
   `?ajax_history=1&get_table_ajax=1`, `?ajax_checks`), not the whole page.

If a failure shape is unavailable, say so **in the type** — an optional field with a comment
naming what was never observed — and branch only on what has been seen.

---

## Step 1 — Go through the session service

`TransactoPanelSessionApiService` owns being logged in. Never post the login form, hold a
cookie or scrape the CSRF token anywhere else.

```typescript
const response = await this.session.run<TransactoPanelCheckResponse>((cookie) =>
  this.httpService.axiosRef.post(url, body, { headers: { Cookie: cookie, ...AJAX_HEADERS } })
)
```

- `run()` presents the cookie, absorbs a re-issued `PHPSESSID`, and repairs **one** dead
  session by logging in again. It hands back the whole `AxiosResponse`, because the status is
  how expiry is recognised.
- `getCsrfToken()` for anything that writes. It is scraped from the payouts page and is bound
  to the PHP session, so it is dropped whenever the panel mints a new one.
- `isSessionAlive()` asks `session_keepalive` — the only way to check credentials without
  touching something that moves money.

**An expired session is a `302` to `/login`, never a `401`.** `TransactoPanelModule` pins
`maxRedirects: 0` and a `validateStatus` that lets the redirect through as a response. Following
it turns an auth failure into `200 text/html` and reads fields off a login page as `undefined`.

### The address you call from

Everything to this host goes out through `ProxyManagerService` — one pool for the process,
shared with the bank scraper. `TransactoPanelSessionApiService` installs a request interceptor
on the panel's axios instance, so **every** panel call is covered, including the rate and payout
services that share the client.

- `PROXY_REQUIRED=true` turns an empty pool into a refusal. Without it a direct request works —
  right up until that address is blocked, and then everything sharing it stops at once.
- `proxy: false` on the client is not a contradiction: it disables *axios's* own proxying, which
  reads `HTTP_PROXY` from the environment and tunnels HTTPS badly. The agent is attached per
  request instead, so a rotation applies to the very next call.
- `run()` retries once from another address on **403, 429, 502, 503 and 504**, logging in again
  afterwards because a new address almost certainly means a new session. The 5xx half is not
  about the panel being unwell: on a residential pool an exit dying mid-request arrives as
  exactly the same status, and only the retry tells them apart. A `302` rotates nothing — the
  address was never the problem there.
- **When something refuses us, the log names who.** `describePanelFailure` prints `cf-ray`,
  `cf-mitigated`, `server` and a short body excerpt, because a `503` from Cloudflare, a `503`
  from the panel and a `503` from the proxy need three different fixes and are otherwise
  identical in a log. **No `cf-ray` means the response never came from that host at all.**
- The client sends the panel's own browser `User-Agent` and `Accept-Language`. This is not
  disguise: we automate our own account, and a PHP operator UI behind Cloudflare receiving
  `axios/1.18.1` from a datacentre address is two signals, of which the proxy fixes one.
- **`Accept-Encoding` must not advertise `zstd`.** The real browser does and Cloudflare will
  serve it; Node cannot decode it, and every table would then parse as zero rows.

---

## Step 2 — Transport in the API service, decisions above it

`TransactoPanelPayoutsApiService` builds requests and returns what came back, unjudged. It will
happily assign a payout it has no business assigning — whether one *should* be taken is
`FiatDepositFacadeService`'s call, and whether a top-up is settled is
`FiatDepositReconcileService` reading Transacto's own answer.

**The `status` field is not one vocabulary.** `'ok'` for payout actions, `'success'` for
keepalive, `'parsing' | 'preview' | 'ok' | 'idle'` for receipts. Never share a constant across
them; each response type carries its own.

---

## Step 3 — Parsing a table

Use `parsePanelPayoutRows` / `parsePanelCheckRows` from `src/shared/utils/panel-table.util.ts`.
If you need a new table, extend that file rather than writing a second parser.

The rules it holds, and why:

- **Read `data-value`, never the rendered text.** The text is localised — sometimes into a
  different language than the cookie asked for — and reformatted for display.
- **Count what you cannot read.** A row that looks like a row and fails to parse is returned in
  `unreadable` and logged as an error by the caller. This is the whole bargain that makes
  hand-parsing HTML acceptable: a markup change must not read as an empty book.
- **Times are UTC+3**; `panelTimestampToDate` applies the shift. JSON bodies from the same host
  are UTC. Never compare the two unshifted.
- **Amounts are decimal strings** (`'1706.00'`) in tables and **plain hryvnia numbers** (`600`)
  in JSON. `panelAmountToKopecks` and `receiptAmountToKopecks` convert them; both use integer
  arithmetic, because `Number(x) * 100` is inexact for some two-decimal values and the error
  lands in somebody's transfer.
- **`Number('')` is `0`.** Every numeric field goes through a strict parser — an emptied
  `payout_id` must not read as payout zero.

---

## Step 4 — The rules with money behind them

These are settled decisions. Changing one is a product decision, not a refactor.

| Rule | Why |
|---|---|
| `force_accept` is always `false` | It pushes a receipt past Transacto's own recognition warning. Using it overrules the counterparty's anti-fraud check on our guess about somebody else's transfer. |
| One receipt in flight per payout | `confirm_check` is addressed **by payout with no job id** — the panel confirms whatever it has parked. Two in flight attach one file's money under another file's name. |
| Release upstream first, write the row second | A row marked released while the payout is still held upstream is a payout nothing is watching: the sweep only looks at live rows. |
| Never auto-release a payout with coverage | Handing back a payout somebody already transferred to gives a stranger their money. It goes to `REVIEW` and waits for a person. |
| Credit on Transacto's word, never on our arithmetic | Coverage is what receipts add up to; settlement is what their history table says. Only `FiatDepositSettlementService.complete` credits, once, conditional on the row still being live. |
| `cred`, `recipient_card`, `sender_account` never reach a log | They are full payment credentials, and the panel hands them over unmasked. |

---

## Step 5 — Prove it without the panel

Everything above is testable with doubles: `session.run` reduced to "call the callback with a
cookie", the parser fed a real fragment copied from a capture. See
`transacto-panel-session.api.service.spec.ts`, `panel-table.util.spec.ts` and
`transacto-panel-payouts.api.service.spec.ts`.

Pin the money rules as their own tests — `force_accept: 'false'` and "never completes a top-up"
are one-line assertions that outlive whoever remembers why.
