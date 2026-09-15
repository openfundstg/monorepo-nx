# Transacto — Nx Monorepo

One repository, one source of truth for wire contracts. Commits span the stack: a contract
change and both consumers land together, and the build fails immediately if they disagree.

| Project                | Path                      | Stack                                            | Tags                             |
| ---------------------- | ------------------------- | ------------------------------------------------ | -------------------------------- |
| `api`                  | `apps/api`                | NestJS 11 + Express + MongoDB + Redis/BullMQ     | `type:app`, `scope:backend`      |
| `monobank-extension`   | `apps/monobank-extension` | Angular 22, Chrome MV3 extension                 | `type:app`, `scope:extension`    |
| `telegram-mini-app`    | `apps/telegram-mini-app`  | Angular 22 + NgRx, Telegram Mini App             | `type:app`, `scope:tma`          |
| `admin`                | `apps/admin`              | Angular 22 + Material + NgRx, served at `/admin` | `type:app`, `scope:admin`        |
| `@transacto/contracts` | `libs/contracts`          | Plain TypeScript, no framework                   | `type:contracts`, `scope:shared` |

## Rules loading

Rules are per-project and **not** all loaded up front. Before writing or reviewing code, read
the `CLAUDE.md` of the project you are touching — each is mandatory, not advisory:

- **Backend** → [apps/api/CLAUDE.md](apps/api/CLAUDE.md). Strict layering
  (`Controller → Service → DB Service`), Mongoose only under `src/modules/repositories/**`,
  `src/*` alias, `ERROR` constants, no hardcoded config.
  - Touching a third-party API → the _Third-party APIs_ section there. Every field the provider
    sends and accepts gets declared, not the subset today's code reads — **and if you are not
    confident the interface is right, ask where the contracts come from before writing it.**
  - New endpoint → skill `create-endpoint`; review → agent `strict-reviewer`.
  - Anything that moves a Mini App user's **spendable balance** goes through
    `BalanceLedgerService`, never straight at `TmaUserDbService`. It moves the money and
    books a row in `tma_balance_entries` saying why — the book whose sum is that balance.
    Only the spendable pot: committing a frozen stake and crediting the referral pot move
    other pots and are accounted for by the sale and `tma_referral_earnings`.
  - Anything touching the Transacto operator panel — the payout book, receipts, the fiat
    top-up — → skill `transacto-panel`. It is HTML-scraped and moves money; do not improvise.
- **Angular apps** → [apps/monobank-extension/CLAUDE.md](apps/monobank-extension/CLAUDE.md),
  [apps/telegram-mini-app/CLAUDE.md](apps/telegram-mini-app/CLAUDE.md) and
  [apps/admin/CLAUDE.md](apps/admin/CLAUDE.md). Zoneless, signal APIs
  only (`@Input()`/`@Output()` banned), modern control flow only (`*ngIf`/`*ngFor` banned),
  three-file standalone components, `enum` over string unions, `as const` for grouped constants.
  - File placement → skill `angular-structure`.
  - The mini app keeps its app-wide state in NgRx — four slices: the launch verdict, the
    user's own figures, the rates, the trust ladder. **A screen that only displays a price
    reads the polled `rates` slice; a screen that prices something takes its rate from the
    response that carried the amounts**, or the quote and the amount can disagree. Everything
    local to one screen stays in component signals.
  - **There are exactly two rates in this product, and the market rate is not one of them.**
    `buyRate` (market less `BUY_DISCOUNT_PERCENT`) is what a user pays per USDT when acquiring
    it; `sellRate` (market plus `SELL_MARKUP_PERCENT`) is what they get per USDT when selling.
    Both live in `libs/contracts/src/lib/constants/rate-spread.ts` and nowhere else — not in an
    env var, not in a column, not on a client. `GET /tma/rates` publishes the two finished
    numbers and _not_ the market, because a rate a screen can read is a rate a screen can
    quote. A sale snapshots its own `exchangeRate` with the markup already inside it, so
    nothing downstream recombines anything; the dashboard's headline percentage is
    `roundTripProfitPercent(buy, sell)`, derived, never written down. Adding a third rate — or
    republishing the market — is the change this arrangement exists to prevent.
  - Two more product rules the mini app enforces on screen and the backend enforces for real,
    so neither may be stated twice. An account that has **never had a deposit credited is
    capped at ₴2 000 per top-up**
    (`NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH` in `apps/api/src/shared/constants/tma.constants.ts`).
    One settled deposit by **any** method, crypto or hryvnia, lifts that cap for good —
    turnover and the trust ladder have nothing to do with it, and `TRUST_LEVELS` rations only
    parallel sales. The filter on the offer is a courtesy; the refusal in
    `FiatDepositFacadeService.reserve` is the rule.
  - The admin panel additionally uses Angular Material and NgRx; its twelve lists share one
    generic collection slice and one generic table, and **every write it makes delegates to the
    service that already owns that operation** rather than reimplementing a settlement path.
    Adding a list → skill `admin-feature`.
- **Contracts** → [CONTRACTS.md](CONTRACTS.md). Anything crossing the wire lives in
  `libs/contracts` and nowhere else.

## User-facing text is never stored or sent

**The database stores keys and data; the client renders the sentence.** A rendered message in a
document is frozen in whichever language wrote it, and a copy of the document per locale is
worse. So an alert, event or error travels as an enum member plus a typed metadata object, and
the frontends translate it.

- Every value a translation interpolates must be in that metadata. A number that exists only
  inside a rendered string is unreachable to the client.
- **Translation keys equal enum members**, so clients build them by concatenation
  (`'ALERTS.' + type + '_DESC'`) instead of maintaining a type → key `switch`.
- API failures carry `{ code, message }` from `ERROR`. Clients switch on `code` and translate;
  `message` is developer-facing English and must never be shown to a user.
- English sentences in `logger.*` are fine — logs are for operators.

Full rules and examples: [apps/api/CLAUDE.md](apps/api/CLAUDE.md#never-store-or-send-user-facing-text).

## Real data never lives in the repository

The repo is history on GitHub, and git remembers every commit. So **no real
personal or financial data is ever committed** — not in a fixture, a test, a doc
comment, an example, or a sample log line. A real value pushed once is exposed
the moment it lands, and scrubbing the working tree does not remove it from
history; only a history rewrite does.

**Real** means captured from an actual bank response or a real person: a real
name or patronymic, a card number (a full PAN **or** a masked one), an IBAN, a
bank receipt or transaction code, a phone number, an email, a postal address, a
real API token or password.

Use **synthetic** values, and make them satisfy whatever the code checks so tests
stay honest: Luhn-valid fake cards (keep only the BIN where BIN logic needs it),
invented names, format- and checksum-valid fake IBANs and receipt codes. A
third-party API's shape is captured as _structure, never its values_ — see that
section in [apps/api/CLAUDE.md](apps/api/CLAUDE.md#third-party-apis-describe-the-whole-contract-or-ask-where-to-find-it).

Secrets are the same rule from the other side: they live only in
`apps/api/src/environments/.env` — gitignored, never committed — and are
documented with placeholders in `.env.example`.

Learnt the expensive way: a developer's own name, cards, IBANs and receipt codes
had been frozen into fixtures and doc comments across ~30 files and pushed.
Removing them took a working-tree scrub **and** a `git filter-repo` history
rewrite with a force-push — the cost this rule exists to never pay again.

## Contracts are the point

Any type shared between the backend and a frontend — DTO shapes, status enums, WebSocket event
names and payloads, error codes — belongs in `@transacto/contracts`. Redeclaring one inside an
app is the exact duplication this repo exists to remove.

`@nx/enforce-module-boundaries` enforces the direction, so violations are lint errors:

- `type:contracts` may depend only on `type:contracts` — the graph always points inward.
- `type:ui` may depend only on `type:contracts` — a shared component knows the wire shapes and
  nothing about any app, or two apps would meet through it.
- `type:app` may reach only `scope:shared`.
- Backend, extension, mini app and admin panel can never import each other.

## Commands

Always run through Nx so the dependency graph and cache apply.

```bash
npx nx run-many -t build --all      # everything
npx nx build api                    # one project
npx nx affected -t build            # only what changed
npx nx build-extension monobank-extension   # ONLY target producing a loadable extension
npx nx serve telegram-mini-app
npx nx serve admin                  # admin panel dev server, proxies /api to :8000
npx nx lint api                     # includes module-boundary checks
npx nx typecheck api                # REQUIRED — `nx build api` does not check types
npx nx test api                     # jest;  nx test monobank-extension = vitest
npx nx db-migrate api -- status     # data migrations: what has run
npx nx db-migrate api -- up         # …and run what has not
npx nx graph                        # visualise dependencies

npx nx run-many -t lint typecheck build test   # the full gate, all 5 projects
```

⚠️ **`nx build api` is transpile-only.** Webpack hands the API's TypeScript to a transpiler that
strips types without checking them, so a file with `const x: number = 'nope'` compiles cleanly.
Run `nx typecheck api` before calling backend work done. The Angular apps and the contracts lib
do typecheck as part of their build; only `api` needs the separate target.

`nx sync` may be required after adding a cross-project import — it writes TypeScript project
references. Nx will tell you when the workspace is out of sync.

## Gotchas

- **`@transacto/history-table` is consumed from source, never built.** It is an Angular
  component library, and plain `tsc` cannot produce a usable one: the `.d.ts` it emits carries
  no Angular metadata, so importing the component fails with `NG2012: Component imports must be
standalone`. A `tsc` project reference forces exactly that, because a composite reference
  redirects imports to the referenced project's _output_ — which is why the library has no
  `tsconfig.json` for `nx sync` to reference, and both apps map it through `paths` instead.
  Consequence: their `tsconfig.app.json` needs `"rootDir": "../.."`, since one program now
  spans the app and the library.

- **`build-extension`, not `build`.** `@angular/build` cleans its output directory, so
  `build-worker` runs after `build`. Plain `build` yields an extension with no service worker.
- **Both frontends default to the production configuration.** `nx build-extension
monobank-extension` bakes in `environment.prod.ts` (`https://openfunds.top`), minifies and
  emits no source maps — 601 kB. For a local build against `http://localhost:8000`, pass
  `--configuration=development`; Nx forwards it down the `build-extension → build-worker →
build` chain.
- **Nothing ships `node_modules`.** The Angular apps are bundled — `dist/` holds only emitted
  JS/CSS/assets. The API image is multi-stage: the builder is discarded and the runtime layer
  carries just the pruned production tree (158 packages, no Angular, Nx or TypeScript).
- **The mini app's cache split is load-bearing.** `apps/telegram-mini-app/Caddyfile` marks the
  content-hashed bundles `immutable` and everything else `no-cache`. Sending no `Cache-Control`
  at all — which it did until this was fixed — lets a client invent freshness from
  `Last-Modified`, and Telegram's in-app WebView then sits on an old `index.html` for days,
  pinned to the bundles that deploy named. Anything added to the build that keeps a stable name
  across deploys (`assets/i18n/*.json` is the one that bites) must stay on the `no-cache` side.

- **`background.ts` is a native ES module.** Relative imports need explicit `.js` extensions or
  Chrome refuses to load the worker.
- **TypeScript 6 removed `baseUrl`.** Use `paths`. The backend additionally needs the same
  alias in `webpack.config.js`, since webpack ignores app-level tsconfig paths.
- **`@ngrx/signals` has no stable Angular 22 build.** A targeted npm `override` relaxes its
  peer; see `overridesComment` in the root `package.json`. Only
  `apps/monobank-extension/src/app/terminal/services/terminal.service.ts` uses it — drop the
  override if that store ever becomes a plain signal service.
- **Data migrations ship inside the API bundle.** The runtime image carries `main.js` and
  its production dependencies — no sources, no TypeScript, no Nx — so the same file is
  also the tool: `docker compose run --rm -T api node main.js migrate up`, or
  `./deploy/migrate.sh up` from your own machine. They are never run automatically; the
  API only logs on boot that something is pending. Adding one →
  [apps/api/CLAUDE.md](apps/api/CLAUDE.md#data-migrations).

- **Production can be read without being touched.** `./deploy/inspect.sh` reaches the live
  logs, MongoDB and Redis over an ssh key pinned to one allowlist, under database accounts
  that hold no write permission, with payment credentials stripped server-side before
  anything is printed. Use it instead of asking for a log paste — and never reach for an
  unrestricted ssh to answer a question it can answer.
  [deploy/inspect/README.md](deploy/inspect/README.md) covers the one-time server setup and
  what each layer actually guarantees. `docker-compose.yml` requires `REDIS_INSPECT_PASSWORD`
  for the read-only Redis account: Redis refuses to start without it rather than starting with
  an empty password.

- `apps/api/src/environments/.env` is gitignored and must exist locally for the API to boot.
  `apps/api/src/environments/.env.example` documents every variable it reads.

- **The admin panel must stay on the API's origin.** It authenticates with a cookie, and
  `main.ts` deliberately does not send `Access-Control-Allow-Credentials` — reflecting arbitrary
  origins _with_ credentials would let any website read an operator's data using their own
  logged-in browser. In production the host proxy routes `/admin*` to the admin container and
  `/api/*` + `/socket.io*` to the backend, all under one hostname:

  The full edge config lives at [deploy/Caddyfile](deploy/Caddyfile) — copy it to
  `/etc/caddy/Caddyfile`. Two things about it are easy to get wrong:

  - **The admin matcher must be `path /admin /admin/*`, not `/admin/*`.** The latter does not
    match a bare `/admin`, so that URL falls through to the catch-all and serves the Mini App.
  - **It is written with `handle` blocks throughout.** Those are evaluated in the order
    written; bare directives are sorted by Caddy's own precedence, which puts `respond` after
    `reverse_proxy` — so a `respond` for `/robots.txt` beside a catch-all proxy never fires.

- **The Transacto operator panel is a _write_ dependency, and its contract is HTML.**
  `app.transacto.us` was a read-only source of one number — the USDT price — and is now the
  settlement path for fiat top-ups: the API logs into it with a session cookie, scrapes its
  payout tables, takes payouts in a user's name, uploads their receipts and releases what nobody
  paid. There is no specification and no JSON for any of it; every shape was captured from a
  browser and is documented in
  [apps/api/src/shared/interfaces/transacto-panel.interface.ts](apps/api/src/shared/interfaces/transacto-panel.interface.ts),
  which is the single home for that knowledge — a copy here would drift from it.

  Four things about it are load-bearing enough to name outside that file:

  - **A markup change is silent.** `panel-table.util.ts` therefore counts rows it cannot read
    and logs an error, so a table that stopped parsing reads as "12 rows unreadable" rather
    than as an empty book. Never make that parser skip quietly.
  - **The tables are UTC+3 while the JSON on the same host is UTC.** Verified against the `Date`
    header of the response carrying both. Nothing may compare the two unshifted.
  - **Recipient card numbers arrive unmasked**, long before a payout is ours — the panel's own
    UI stars them out in JavaScript. They must never reach a log line.
  - **Adding a call means capturing it first.** The `transacto-panel` skill has the checklist,
    including the failing responses that are the easiest to forget and the hardest to guess.
  - **All of it goes out through the proxy pool**, because the host is behind Cloudflare and a
    block lands on the address rather than on the account — taking the rate, the book and every
    receipt with it. `PROXY_URLS` is one pool for the process, shared with the bank scraper;
    `PROXY_REQUIRED=true` makes an empty pool a refusal instead of a direct request. The panel
    client also sends the browser's own `User-Agent`: the proxy fixes the address, and
    `axios/1.18.1` from a datacentre is the other half of the signal.

- **A fiat receipt is proven before Transacto is told anything, and the two banks are
  proven in completely different ways.** The upload is evidence somebody holds a receipt;
  a screenshot is whatever an image editor made it. Asking a counterparty to catch a forged
  receipt for us was the arrangement this replaced.

  - **Monobank is proven by its signature.** The receipt a bank serves is a PKCS#7/CAdES
    container — `api.monobank.ua/bank/receipt/…` answers `Content-Type: application/pdf`
    and sends an envelope with the document inside, signed under DSTU, which `openssl`
    cannot even verify — and a user who saves their own copy saves that envelope.
    `ca.monobank.ua/siteapi/verify` checks that signature: a document altered by **one bit**
    comes back `signatureValid: false`. That is a stronger claim than the lookup it
    replaced, and it needs no browser, so `check.gov.ua` is gone and Chrome left the
    sidecar image with it (1.38 GB → 376 MB).
    - **`signatureValid: true` proves nothing about the bank.** A qualified certificate can
      be bought by anybody, so a forger signs their own invented receipt and the service
      confirms — truthfully — that the signature is valid. The signer is what makes it a
      bank document: `organization` must be `АТ «УНІВЕРСАЛ БАНК»` and `issuer`
      `КНЕДП monobank | Universal Bank`. Without that check this is a forgery laundry.
    - **A refusal is a `200`.** Only a body that is not a signed container at all is a
      `400`. Reading the status alone would record a forgery as a success.
    - **`signingTime` is not the payment time.** It is when the document was produced, and
      one payment yields several validly signed documents with different signing times —
      observed at `12:15:44Z` and `16:58:38Z` for the same transfer. The sum, the recipient
      and the moment are read from the document, which the signature has just proven was
      not edited.
    - **The envelope is verified and the document inside is forwarded.** Transacto's
      recognition reads a PDF and reports a container as an unreadable file, in the one way
      that looks like the user's fault. `ReceiptSubmission` carries both for exactly this
      reason — unwrapping before verification destroys the thing being checked, which is
      what the callers used to do.
  - **PrivatBank is proven by its code.** `privatbank.ua/pb/ajax/find-document` needs no
    browser either — a clean session is answered normally — and says only that the code
    exists, so its adapter downloads PrivatBank's own copy and reads the sum, the account
    and the date out of the PDF. Their codes are different identifiers from monobank's
    (`P24A0000000000A0000` versus `6K4A-0000-0000-0000`). Adding a bank → a
    `ReceiptCodeStrategy`, and a provider that claims it, listed in
    `receipt-verification.module.ts`; nothing else.
  - **A PrivatBank receipt names the recipient's card only when the money left PrivatBank.**
    Inside PrivatBank it prints their IBAN instead, and **Transacto's payout row leaves
    `recipient_name` empty on every UAH row observed** — so on that one combination neither
    side states the recipient comparably and the check cannot run at all. Such a receipt is
    **not** refused: it verifies as `VERIFIED_EXCEPT_RECIPIENT`, goes to Transacto for their
    own recognition to judge, and is stored with `recipientChecked: false`. The concession
    is exactly one reason wide — the moment anything else disagrees it is an ordinary
    mismatch, because a receipt already wrong about the sum has not earned the benefit of
    the doubt about who was paid.
  - **Monobank prints the recipient's name only when the recipient is theirs.**
    A transfer out to another bank reads `Одержувач Банк одержувач ПриватБанк`
    with no `Ім'я` at all, so the parser anchors on the pair
    `Одержувач … Банк одержувач` and never on the name. Anchoring on
    `Одержувач Ім'я` failed **every outbound transfer**: a genuine ₴1 000 top-up
    verified its signature and was then refused by our own reader. The same
    receipt masks the _payer's_ card two labels above the recipient's, which is
    why the block has to be anchored rather than found by distance — and why the
    card is validated by the shared `readRecipientCard`, which takes one masked
    or whole, instead of a private sixteen-digit rule.
  - **"The layout could not be read" is not a diagnosis.** That failure names
    the labels it could not find (`monobankReceiptGaps`), because the first time
    it happened the log named all three fields whether or not each was the
    problem, and the only way to learn which had moved was to obtain the
    document. Labels are theirs and safe to print; everything they point at is
    somebody's payment credential.
  - **A receipt may state more than the payout, and only more.** A transfer fee
    is the payer's, and some banks fold it into the amount rather than a field
    of its own: a monobank receipt for a ₴1 470 top-up read `Сума (грн)
1 477.39`, with ₴1 470 nowhere on the document. So the amount check accepts
    an overage of up to **5%** of the _outstanding_ amount and refuses one
    kopeck below it — the asymmetry is the rule, because underpayment is what
    the check exists to catch. What is credited is always the payout's amount,
    never the receipt's, so the fee stays the payer's; the Mini App says so on
    the payment screen rather than leaving people to learn it from a refusal.
    Five per cent is far wider than any fee observed (that one is 0.5%) and it
    can afford to be, because this is a gate on _forwarding_ — a receipt that
    passes still has to satisfy Transacto's own recognition before anything is
    credited, and a user has at most one live top-up, so a receipt cannot be
    shopped between two of their own payouts.
  - **The extracted text is a payment credential.** A monobank receipt states the
    recipient's card unmasked. Only its length may be logged — as with the recipient itself,
    masked or whole. Everything else on the path is logged in full, under the top-up's id,
    so one receipt can be followed end to end.
  - **`apps/receipt-checker` now only reads files, and its network is `internal`.** It
    parses PDFs strangers upload, so: a current base image, non-root, `cap_drop: ALL`,
    `no-new-privileges`, parsing in a child process under `RLIMIT_AS`, `RLIMIT_CPU` and a
    wall clock, and `init: true` to reap what that leaves. Since the browser went it makes
    no outbound connection at all, which is why the segment is sealed rather than merely
    separate.
  - **`RECEIPT_VERIFICATION_REQUIRED` fails closed**, exactly as `PROXY_REQUIRED` does.
  - **PrivatBank is on a pool of its own, over Tor, and that is not a general answer.**
    The shared provider refuses the _destination_ rather than the request: in one process
    inside one minute, `CONNECT` to `app.transacto.us` succeeded twice while `CONNECT` to
    `privatbank.ua` was refused on three consecutive addresses, and it refuses `.gov.ua`
    the same way. Proven to be the gateway rather than the destination: `CONNECT` to
    `check.gov.ua` by name is refused where `CONNECT` to that same host's **IP** opens and
    the site answers `200`. So `PRIVATBANK_PROXY_URLS` routes that one caller through the
    `tor` container, and unset it changes nothing. Monobank does not need it —
    `ca.monobank.ua` answers through the shared pool on every address tried. **An entry in
    the Tor pool is a credential, not a host**: Tor gives each set of proxy credentials its
    own circuit, so the entries differ only in username, rotating one rotates the exit node,
    and one username holds a single address across a lookup and the download after it.
  - **Anything through a pool walks up to `PROXY_ATTEMPTS` addresses**, on the statuses
    _and the transport failures_ in `shared/utils/proxy-retry.util.ts`, whose
    `walkingThePool` is the one home for that walk. **A `503` with an empty body is the
    proxy, not the destination.** A proxy that declines a `CONNECT` answers on the socket
    the request was about to use, so Node parses its reply as the host's: axios reports
    `503`, `ERR_BAD_RESPONSE` and no body, which reads exactly like the destination refusing
    us. `describeRefusal` says so in the log line. Reading it literally sent a day's
    investigation at PrivatBank while PrivatBank was answering `200` to anyone who asked
    directly. `403`/`429` is a filter refusing the address and `502`/`503`/`504` on a
    residential pool is usually the exit dying; `404` and `400` are answers and are never
    retried, because spending an IP to hear the same thing is how an outage gets
    manufactured. **The login rotates too**, which it did not: every other panel call goes
    through `run`, but with no session there is nothing for `run` to do.

- **The whole site is kept out of search results at the edge**, by both halves of the job:
  `robots.txt` asks crawlers not to fetch, and an `X-Robots-Tag: noindex` header on every
  response — including the proxied ones — tells them not to index what they fetched anyway,
  which is what happens when somebody links to a page. Neither alone is enough.

- **`ADMIN_USERNAME` and `ADMIN_PASSWORD` are both required** for the panel to work. With
  either missing every login is refused, not allowed — an unset password locks the panel rather
  than opening it.

- **Angular versions are pinned exactly in `apps/admin/package.json`.** Two copies of
  `@angular/core` in one workspace are two distinct `InjectionToken` types, and Material's DI
  tokens then stop type-matching. A floating range resolved this app one patch ahead of the
  others and nested a second copy.

## Project structure

Both Angular apps follow the same shape, enforced by the `angular-structure` skill:

```
app/
├── core/            app-wide singletons only (socket, interceptors, the rates slice)
├── shared/          stateless pieces used by 2+ modules (pipes, utils)
└── <module>/        auth · dashboard · terminal · settings · deposit · sale · …
    ├── pages/       routed views          — three files each: .ts + .html + .scss
    ├── components/  used inside templates — three files each
    ├── services/    <name>.service.ts (logic + state) · <name>.api.service.ts (HTTP only)
    ├── store/       <slice>.{state,actions,reducer,selectors,effects}.ts — NgRx apps only
    ├── modals/      <name>/<name>.modal.ts — three files, like a component
    ├── enums/ interfaces/ guards/ utils/
    └── routes.ts    lazily loaded from app.routes.ts
```

The backend mirrors it with its own layering — see [apps/api/CLAUDE.md](apps/api/CLAUDE.md):

```
src/modules/
├── auth/                    decorators + guards; every endpoint carries exactly one
├── repositories/{x}-db/     the ONLY place Mongoose exists
└── {domain}/                controller → services/{domain}.service.ts → *-db.service.ts
```

## Refactor status

The structural refactor is **complete** across all four projects: repository layer extracted,
access control centralised, `bank-scraper` normalised, both Angular apps moved onto the module
layout, and localization moved to key-plus-data everywhere.

`apps/api`, `apps/monobank-extension` and `apps/telegram-mini-app` each carry a
`REFACTORING.md`. They are now mostly a record of what was done and why, plus a short ⬜ list of
open decisions. They are backlogs, never precedent — new code follows the rules even where
neighbouring code has not caught up. The admin panel has none: it was built after the refactor,
so there is nothing for it to record.

Known open items worth reading before starting work: the mini app's tests cover the
sale form, the route guard, the store's reducers and selectors, the i18n dictionaries and
a handful of shared services — **not** its pages, which are still untested. Every
`WsEventNames` member is now emitted by something — `TERMINAL_ENABLED` and `TERMINAL_DISABLED`
were dead for a long time and are live as of `TerminalBroadcastService`.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
