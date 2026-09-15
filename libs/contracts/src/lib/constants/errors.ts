/**
 * Every error the API can return, as `{ code, message }`.
 *
 * Thrown as the body of a NestJS HTTP exception:
 *
 *     throw new UnauthorizedException(ERROR.AUTH.INVALID_API_TOKEN)
 *
 * Clients switch on `code`, never on `message` — messages are free to change,
 * codes are not. Domains are blocked in increments of 100; add new domains at
 * the next free block rather than reusing gaps.
 */
export const ERROR = {
  /** 1000 — extension / trader API-token auth */
  AUTH: {
    INVALID_API_TOKEN: { code: 1000, message: 'Invalid or inactive API token' },
    TRADER_ACCESS_DENIED: { code: 1001, message: 'Access denied for this traderId' },
    INVALID_TRANSACTO_PROFILE: { code: 1002, message: 'Invalid profile data from Transacto' },
    MISSING_API_TOKEN_HEADER: { code: 1003, message: 'Missing X-API-TOKEN header' },
    CSRF_TOKEN_MISMATCH: { code: 1004, message: 'CSRF token missing or does not match' },
  },

  /** 1100 — Telegram Mini App initData auth */
  TMA_AUTH: {
    MISSING_INIT_DATA_HEADER: { code: 1100, message: 'Missing x-tma-init-data header' },
    MISSING_HASH: { code: 1101, message: 'Missing hash in initData' },
    SERVER_MISCONFIGURED: { code: 1102, message: 'Server configuration error' },
    INVALID_SIGNATURE: { code: 1103, message: 'Invalid initData signature' },
    EXPIRED: { code: 1104, message: 'initData has expired' },
    MISSING_USER: { code: 1105, message: 'Missing user in initData' },
    INVALID_USER_DATA: { code: 1106, message: 'Invalid user data in initData' },
    INVALID_INIT_DATA: { code: 1107, message: 'Invalid initData' },
  },

  /** 1200 — crypto deposits */
  DEPOSIT: {
    NOT_FOUND: { code: 1200, message: 'Deposit not found' },
    NOT_OWNED: { code: 1201, message: 'Deposit does not belong to this user' },
    ALREADY_VERIFIED: { code: 1202, message: 'Deposit already verified' },
    TX_ALREADY_SUBMITTED: { code: 1203, message: 'This transaction ID has already been submitted' },
    TX_NOT_FOUND: {
      code: 1204,
      message: 'Transaction not found on the blockchain. Please check the TxID and try again.',
    },
    TX_NOT_CONFIRMED: {
      code: 1205,
      message: 'Transaction is not yet confirmed. Please wait and try again.',
    },
    TX_WRONG_RECIPIENT: {
      code: 1206,
      message: 'Transaction recipient does not match our wallet address',
    },
    TX_AMOUNT_MISMATCH: { code: 1207, message: 'Transaction amount does not match the deposit' },
    /**
     * The chain could not be reached — rate limit, outage, timeout.
     *
     * Deliberately distinct from {@link TX_NOT_FOUND}: "we could not look" and
     * "it is not there" are opposite messages to a user who has genuinely sent
     * money, and collapsing them told depositors their transaction did not
     * exist whenever TronGrid rate-limited us.
     */
    VERIFICATION_UNAVAILABLE: {
      code: 1208,
      message: 'Could not reach the blockchain to verify this transaction',
    },
    /** Below `MIN_USDT_AMOUNT` — too small to be worth a transfer. */
    BELOW_MINIMUM: { code: 1209, message: 'Deposit amount is below the minimum' },
  },

  /** 1300 — sales */
  SALE: {
    NOT_FOUND: { code: 1300, message: 'Sale not found' },
    USER_NOT_FOUND: { code: 1301, message: 'User not found' },
    // 1302 is retired. A trust level no longer caps the size of a single order:
    // the stake already bounds it, and capping the amount left a user free to
    // run any number of small orders at once. What a level limits now is how
    // many run in parallel — see PARALLEL_LIMIT_REACHED.
    INSUFFICIENT_BALANCE: { code: 1303, message: 'Insufficient balance' },
    /**
     * The user already has as many sales running as their trust level
     * allows: one at NEWBIE, three at EXPERIENCED, five at PRO.
     *
     * A slot is held by an order that is still watching its terminal *and* by
     * one that was BLOCKED — that stake stays frozen and the order was stopped
     * for breaking a rule, so freeing the slot would make being blocked
     * cost nothing.
     */
    PARALLEL_LIMIT_REACHED: {
      code: 1317,
      message: 'You already have as many sales running as your trust level allows',
    },
    /**
     * Another create for this same user is mid-flight.
     *
     * Almost always a double-tap, and rejecting the second is the right answer
     * to that. It exists because the parallel-order check is otherwise a
     * count-then-insert, and two requests in the same instant would both read a
     * free slot and both take it.
     */
    CREATE_IN_PROGRESS: {
      code: 1318,
      message: 'A sale is already being created for this user',
    },
    /**
     * The bank is switched off for new sales — see
     * `SALE_ENABLED_BANKS`. Creation only: orders already running on
     * that bank are unaffected.
     */
    BANK_UNAVAILABLE: {
      code: 1319,
      message: 'Sales are not available for this bank right now',
    },
    /**
     * The bank was supposed to name the card its link pays into and did not.
     *
     * For a bank in `BANKS_DISCLOSING_CARD` the card is not the user's to
     * supply, so there is nothing to fall back to. Accepting a typed number
     * here would put an unverified account into the system through the one
     * route built to make that impossible.
     */
    CARD_NOT_DISCLOSED: {
      code: 1320,
      message: 'The bank did not disclose the card this link pays into',
    },
    /**
     * The typed card cannot be the one the drop link pays into.
     *
     * For a bank in `BANKS_MASKING_CARD` the link publishes part of its card,
     * and a number disagreeing with the visible digits is refused outright.
     * Distinct from {@link CARD_NOT_DISCLOSED}, which is the bank telling us
     * nothing at all: here it told us enough, and the answer was no.
     */
    CARD_MASK_MISMATCH: {
      code: 1321,
      message: 'This card is not the one the drop link pays into',
    },
    /**
     * `RELEASE_JAR` on a sale whose jar is already recorded as closed.
     *
     * Operator-facing only: it means the slot this was meant to free is not
     * held by this sale, so pressing again would move a timestamp somebody —
     * or the bank — already set, and hide when the release actually happened.
     */
    JAR_ALREADY_CLOSED: {
      code: 1322,
      message: 'This sale’s jar is already recorded as closed',
    },
    UNSUPPORTED_BANK_TYPE: { code: 1304, message: 'Unsupported bank type' },
    INVALID_ID: { code: 1305, message: 'Malformed sale id' },
    /** Every generation attempt collided — effectively impossible, so it is a 500. */
    PUBLIC_ID_GENERATION_FAILED: {
      code: 1306,
      message: 'Could not allocate a unique public id for the sale',
    },
    /** The pasted link is not on any host this bank is known to serve from. */
    DROP_LINK_UNSUPPORTED_HOST: {
      code: 1307,
      message: 'This link does not belong to the selected bank',
    },
    /**
     * The redirect chain was followed but never arrived at a link the scraper
     * can read — for PUMB, one carrying a `box_id`.
     */
    DROP_LINK_UNRESOLVED: {
      code: 1308,
      message: 'Could not determine the destination of this link',
    },
    /** The bank did not answer while the redirect was being followed. */
    DROP_LINK_RESOLUTION_FAILED: {
      code: 1309,
      message: 'The bank did not respond while resolving this link',
    },
    /**
     * The jar's target does not match the order — caught before anything is
     * frozen, rather than blocking the order once it is already running.
     */
    GOAL_MISMATCH: {
      code: 1310,
      message: 'The jar target does not match the order amount',
    },
    /**
     * The card the user typed is not the card the drop link pays into.
     *
     * Caught at creation, before anything is frozen. The two used to be
     * accepted as an unrelated pair, and the mismatch only surfaced later as
     * three expired orders and an `ORDERS_EXPIRED` block — with the stake
     * already frozen and the user none the wiser about why.
     */
    CARD_MISMATCH: {
      code: 1315,
      message: 'The card number does not match the one the drop link pays into',
    },
    /**
     * The market moved between the quote and the submit, far enough to change
     * the target the user was told to set as their jar's goal.
     *
     * Not an error in what they did — it is a race with the market. The client
     * shows the new figure and asks them to check it against the goal already
     * set in their bank, because a jar whose target no longer matches can never
     * fill.
     */
    RATE_CHANGED: {
      code: 1316,
      message: 'The exchange rate changed; the order total no longer matches the quote',
    },
    /** The jar is closed or archived, so it can never receive the payment. */
    JAR_NOT_ACTIVE: { code: 1311, message: 'This jar is not active' },
    /**
     * Someone may still pay into this terminal, so the stake cannot be given
     * back yet — releasing it while an order is live would hand the user their
     * USDT and the payer's hryvnia both.
     */
    CANCEL_HAS_OPEN_ORDERS: {
      code: 1312,
      message: 'This sale still has orders that are not settled',
    },
    /** Already completed, failed, blocked or cancelled — nothing left to stop. */
    NOT_CANCELLABLE: { code: 1313, message: 'This sale can no longer be stopped' },
    /**
     * Below `MIN_USDT_AMOUNT`. Measured on the USDT the user actually funds,
     * not on the hryvnia target — the target includes profit, so checking it
     * would let an order through that stakes less than the floor.
     */
    BELOW_MINIMUM: { code: 1314, message: 'Sale amount is below the minimum' },
  },

  /** 1400 — terminals */
  TERMINAL: {
    NOT_FOUND: { code: 1400, message: 'Terminal not found' },
    INVALID_CARD_ID: { code: 1401, message: 'Invalid cardId' },
    DISABLED_OR_DEAD: { code: 1402, message: 'Terminal is disabled or dead' },
    INACTIVE: { code: 1403, message: 'Terminal is not active or not found' },
    MISSING_CRED: { code: 1404, message: 'Terminal has no cred3 configuration' },
    INVALID_CRED_URL: { code: 1405, message: 'Invalid bank URL format in cred3' },
  },

  /** 1900 — alerts */
  ALERT: {
    NOT_FOUND: { code: 1900, message: 'Alert not found' },
    ALREADY_RESOLVED: { code: 1901, message: 'Alert not found or already resolved' },
    NOT_RESOLVABLE: {
      code: 1902,
      message: 'Alert not found, already resolved, or unauthorized',
    },
  },

  /** 1500 — bank scraping */
  SCRAPER: {
    UNSUPPORTED_BANK_URL: { code: 1500, message: 'Unsupported bank URL for this terminal' },
    PROCESSING_FAILED: { code: 1501, message: 'Error processing terminal' },
    RATE_LIMITED: { code: 1502, message: 'Bank API rate limit or WAF block' },
    INVALID_BALANCE_FORMAT: { code: 1503, message: 'Invalid balance format received from bank' },
  },

  /** 1700 — Telegram Mini App user + balance ledger */
  TMA_USER: {
    NOT_FOUND: { code: 1700, message: 'User not found' },
    INSUFFICIENT_BALANCE: { code: 1701, message: 'Insufficient available balance' },
    INSUFFICIENT_FROZEN_BALANCE: { code: 1702, message: 'Insufficient frozen balance' },
  },

  /** 1800 — server-side configuration problems (never the caller's fault) */
  CONFIG: {
    MISSING_TRADER_API_TOKEN: {
      code: 1800,
      message: 'TMA service trader API token is not configured',
    },
    /** The configured TMA token exists but Transacto will not resolve it to a trader. */
    UNRESOLVABLE_TRADER_API_TOKEN: {
      code: 1802,
      message: 'TMA service trader API token could not be resolved to a trader',
    },
    /** An endpoint reached runtime without an access decorator — fail closed. */
    MISSING_ACCESS_DECORATOR: { code: 1801, message: 'Endpoint access rules are not configured' },
    // 1803 is retired. The USDT→UAH rate is no longer configuration — it comes
    // from the live market for deposits and sales alike, so its failure
    // is an outage, not a misconfiguration: see EXCHANGE_RATE.UNAVAILABLE.
    /** Without the bot's @username there is no deep link to hand the user. */
    MISSING_BOT_USERNAME: { code: 1804, message: 'Telegram bot username is not configured' },
    /**
     * The support bot's webhook is reachable but no shared secret is set, so
     * the guard cannot tell Telegram apart from anyone who guessed the path.
     * Fail closed rather than accept the delivery.
     */
    MISSING_SUPPORT_WEBHOOK_SECRET: {
      code: 1805,
      message: 'Telegram support webhook secret is not configured',
    },
    /**
     * A caller that must not go out from our own address has no proxy to use.
     *
     * Configuration rather than an outage, and a refusal rather than a
     * fallback: the direct request would succeed, which is precisely the
     * failure — it works until the address it came from is blocked, and then
     * everything that shares that address stops at once.
     */
    MISSING_PROXY: { code: 1807, message: 'An outbound proxy is required but none is configured' },
    /** No forum supergroup to route support conversations into. */
    MISSING_SUPPORT_GROUP_ID: {
      code: 1806,
      message: 'Telegram support group id is not configured',
    },
  },

  /**
   * 2100 — USDT→UAH pricing.
   *
   * One rate, one source, for every product that quotes a price. Deposits and
   * sales both take it from the live market, so neither can be settled
   * against a number the other has never seen.
   */
  EXCHANGE_RATE: {
    /**
     * The market could not be reached — outage, rate limit, timeout.
     *
     * There is deliberately no configured fallback behind this. A rate is a
     * *price*: it is multiplied by a user's crypto and snapshotted onto the
     * deposit or order, so a stale figure does not degrade gracefully — it
     * silently mints or destroys value, and drifts further from the market
     * every day nobody notices. Refusing to quote is the safe failure.
     */
    UNAVAILABLE: { code: 2100, message: 'Live USDT/UAH exchange rate is unavailable' },
  },

  /** 2000 — referral programme */
  REFERRAL: {
    CODE_NOT_FOUND: { code: 2000, message: 'No user owns this referral code' },
    /** A code was redeemed once already; the binding is permanent. */
    ALREADY_REFERRED: { code: 2001, message: 'You already have a referrer' },
    SELF_REFERRAL: { code: 2002, message: 'You cannot use your own referral code' },
    /**
     * Manual redemption is only open to a user who has not sold yet —
     * otherwise an established user could be back-dated onto a link.
     */
    NOT_ELIGIBLE: {
      code: 2003,
      message: 'A referral code can only be redeemed before your first completed sale',
    },
    INSUFFICIENT_BALANCE: { code: 2004, message: 'Insufficient referral balance' },
    INVALID_AMOUNT: { code: 2005, message: 'Transfer amount must be a positive number of cents' },
    /** Every generation attempt collided — effectively impossible, so it is a 500. */
    CODE_GENERATION_FAILED: {
      code: 2006,
      message: 'Could not allocate a unique referral code',
    },
  },

  /** 1600 — inbound Transacto webhook */
  WEBHOOK: {
    MISSING_TRADER_ID: { code: 1600, message: 'Missing or invalid trader_id in request body' },
    UNKNOWN_TRADER: { code: 1601, message: 'Unknown trader' },
    TRADER_INACTIVE: { code: 1602, message: 'Trader is not active' },
    INVALID_SIGNATURE: { code: 1603, message: 'Invalid webhook signature' },
    /**
     * The delivery is authentic but does not carry the fields we act on.
     *
     * Distinct from a bad signature: this one came from Transacto, so the
     * mismatch is between their payload and our DTO, and the log line that
     * accompanies it names the failing properties.
     */
    INVALID_PAYLOAD: { code: 1604, message: 'Webhook payload failed validation' },
  },

  /**
   * 2200 — the Telegram support bot.
   *
   * Nothing here is ever rendered to an end user: the only caller of these
   * endpoints is Telegram itself, which reads the status code and retries. They
   * exist so a rejected delivery is identifiable in a log and in a client that
   * switches on `code`, exactly like every other failure in this file.
   */
  SUPPORT: {
    /** The `X-Telegram-Bot-Api-Secret-Token` header was absent or did not match. */
    INVALID_WEBHOOK_SECRET: { code: 2200, message: 'Invalid Telegram webhook secret token' },
    /** The body is not a Telegram `Update` — no usable `update_id`. */
    INVALID_UPDATE: { code: 2201, message: 'Telegram update payload failed validation' },
    /**
     * Relaying failed against Telegram itself. Deliberately a 5xx: Telegram
     * retries a failed webhook delivery, and a support message silently
     * swallowed is worse than a duplicate.
     */
    RELAY_FAILED: { code: 2202, message: 'Could not relay the support message' },
    /**
     * Telegram answered `200 OK` with `ok: false`, which its documentation
     * allows and which axios therefore does not throw on. Distinct from
     * {@link RELAY_FAILED} so the log says whose fault the failure was.
     */
    TELEGRAM_API_FAILED: { code: 2203, message: 'Telegram Bot API rejected the call' },
  },

  /**
   * 2300 — the admin panel.
   *
   * Unlike every other domain here, these messages *are* read by the person who
   * caused them: the only caller is an operator sitting in front of the panel.
   * They are still developer-facing English — the panel switches on `code` and
   * renders its own copy, exactly like the other two frontends.
   */
  ADMIN: {
    /**
     * Wrong username or wrong password, deliberately indistinguishable.
     *
     * Saying which half was wrong tells an attacker they have found a valid
     * username, and there is exactly one of those.
     */
    INVALID_CREDENTIALS: { code: 2300, message: 'Invalid username or password' },
    /** No session cookie, or one naming a session that has expired or been revoked. */
    NO_SESSION: { code: 2301, message: 'Not authenticated' },
    /**
     * `ADMIN_USERNAME` or `ADMIN_PASSWORD` is missing from the environment.
     *
     * A 500 rather than a 401: with no credentials configured there is nothing
     * to authenticate *against*, and answering 401 would present a login form
     * that cannot ever succeed. Never let this fall through to "access
     * granted" — an unset password must lock the panel, not open it.
     */
    NOT_CONFIGURED: { code: 2302, message: 'Admin credentials are not configured' },
    /** Too many failed logins from this address; the lockout is time-based. */
    TOO_MANY_ATTEMPTS: { code: 2303, message: 'Too many failed login attempts' },
    /** The correction would take a balance below zero. */
    INSUFFICIENT_BALANCE: {
      code: 2304,
      message: 'The account does not hold enough for this debit',
    },
    /** A manual correction must carry a positive number of cents. */
    INVALID_AMOUNT: { code: 2305, message: 'Amount must be a positive number of cents' },
    /**
     * The order is already settled, so the requested action has nothing to act
     * on. Distinct from a missing order: this one exists and the operator is
     * looking at it.
     */
    ORDER_NOT_ACTIONABLE: {
      code: 2306,
      message: 'This sale is already in a final state',
    },
    /** Neither `enabled` nor `acceptingOrders` was supplied. */
    NO_STATE_CHANGE: { code: 2307, message: 'No terminal state change was requested' },
    /**
     * The terminal exists but the trader row behind it does not.
     *
     * A refusal rather than a local-only write: without that trader's API token
     * nothing can be said to Transacto, and the terminals sync reads the
     * upstream flags back — so a flag flipped here alone is undone within the
     * minute, leaving an operator looking at a button that appears not to work.
     */
    TRADER_NOT_FOUND: { code: 2308, message: 'The trader behind this terminal no longer exists' },
    /**
     * The refund an operator typed is larger than the order's own stake.
     *
     * Refused rather than clamped. Unfreezing more than was frozen takes money
     * out of a pot that never held it and leaves the user's frozen balance
     * permanently wrong; paying somebody more than their stake is a balance
     * correction, which is its own audited action with its own reason.
     */
    REFUND_EXCEEDS_STAKE: {
      code: 2309,
      message: 'The refund cannot be larger than the stake frozen for this order',
    },
    ALERT_NOT_FOUND: { code: 2310, message: 'Alert not found' },
  },

  /** 2400 — fiat top-ups settled by paying a Transacto payout */
  FIAT_DEPOSIT: {
    /**
     * Transacto's book of open payouts could not be read.
     *
     * An outage rather than an empty book: "we cannot look" and "there is
     * nothing to take" are opposite messages to somebody trying to add money,
     * and a client that showed the second would tell them the product is closed
     * whenever the panel hiccups.
     */
    BOOK_UNAVAILABLE: { code: 2400, message: 'The payout book is unavailable' },
    /**
     * No open payout carries this amount any more.
     *
     * The ordinary outcome of two users tapping the same figure: the book is a
     * live queue and reservation is the only claim on a row, so one of them
     * loses the race and is asked to pick again.
     */
    AMOUNT_UNAVAILABLE: { code: 2401, message: 'This amount is no longer available' },
    /**
     * The user already holds a top-up that is still running.
     *
     * One at a time: a second reservation would put two strangers' payouts on
     * one person's card at once, and a receipt could then be matched to the
     * wrong one.
     */
    ALREADY_ACTIVE: { code: 2402, message: 'This user already has an active fiat top-up' },
    NOT_FOUND: { code: 2403, message: 'Fiat top-up not found' },
    NOT_OWNED: { code: 2404, message: 'Fiat top-up does not belong to this user' },
    /** Expired, completed or awaiting an operator — no receipt can change it. */
    NOT_PAYABLE: { code: 2405, message: 'This top-up no longer accepts receipts' },
    RECEIPT_UNSUPPORTED_TYPE: { code: 2406, message: 'Receipt must be a PDF or an image' },
    RECEIPT_TOO_LARGE: { code: 2407, message: 'Receipt file is too large' },
    RECEIPT_REJECTED: { code: 2408, message: 'The receipt was not accepted for this payout' },
    RECEIPT_PARSE_TIMEOUT: {
      code: 2409,
      message: 'Receipt recognition did not finish in time',
    },
    /**
     * Another receipt on this payout is still being recognised.
     *
     * Upstream keeps exactly one parsed receipt per payout and confirms it by
     * payout id with no job id, so a second upload arriving mid-flight would
     * confirm whichever of the two happened to be parked there. Refusing the
     * second is what keeps a receipt attached to the file it came from.
     */
    RECEIPT_IN_FLIGHT: {
      code: 2410,
      message: 'A receipt for this top-up is still being processed',
    },
    /**
     * The amount is above what an account with no completed deposit may top up
     * with.
     *
     * Its own code rather than {@link AMOUNT_UNAVAILABLE}, which it would
     * otherwise be indistinguishable from: one says "somebody took it, pick
     * again" and the other says "this sum is not offered to you yet", and a
     * client that conflated them would send a new account round a list refusing
     * every tap for a reason it never gave.
     *
     * Kept at 2411 through the rename from `ABOVE_TRUST_LIMIT`: what lifts the
     * ceiling changed — a first credited deposit rather than turnover — but the
     * refusal a client has to render is the same one, and a client in the wild
     * translates the number.
     *
     * Reached only by a client that asked for an amount the options call did
     * not offer it — a stale screen, or a hand-made request. The filter on the
     * offer is the courtesy; this is the rule.
     */
    ABOVE_FIRST_DEPOSIT_LIMIT: {
      code: 2411,
      message: 'This amount is above the limit for an account with no completed deposit',
    },
    /**
     * The pay window has closed, so no receipt will be taken for this top-up.
     *
     * Its own code rather than {@link NOT_PAYABLE}, which is about the top-up
     * being over: this one is still live and its payout is still held — what
     * ran out is the time to prove a transfer. The two need different sentences
     * because they leave the user in different places, and only this one has a
     * way forward: an appeal, which puts it in front of an operator.
     */
    PAY_WINDOW_CLOSED: {
      code: 2412,
      message: 'The window to upload a receipt for this top-up has closed',
    },
    /**
     * No receipt code could be read out of the uploaded file.
     *
     * The user's to fix, and the only verification failure that is: the state
     * receipt service is asked by code, and a photograph too blurred to read one
     * out of leaves nothing to ask about. So it refuses the *upload* — the
     * top-up stays live, its payout stays held, and the next attempt with the
     * bank's own PDF succeeds — where a receipt the service disowns refuses the
     * top-up itself.
     *
     * A client should say what to send instead: the receipt downloaded from the
     * banking app, not a screenshot of it.
     */
    RECEIPT_CODE_UNREADABLE: {
      code: 2413,
      message: 'No receipt code could be read from this file',
    },
    /**
     * Receipts must be verified here and no verifier is configured.
     *
     * A deployment fault, not a user's, and it fails closed for the same reason
     * `ERROR.CONFIG.MISSING_PROXY` does: a check on somebody's money that
     * quietly stops running when its configuration is absent is worse than one
     * that was never claimed. `RECEIPT_VERIFICATION_REQUIRED` is what turns the
     * absence into this refusal, so a developer still runs without the sidecar
     * while production will not.
     */
    RECEIPT_VERIFIER_UNAVAILABLE: {
      code: 2414,
      message: 'Receipt verification is required and no verifier is configured',
    },
    /**
     * The requested range is not one this product could ever fill.
     *
     * Two conditions under one code, because a client renders one sentence for
     * both and the remedy is the same — type a different range. They are: a
     * **maximum below the minimum**, and a maximum so small that even it buys
     * less than the product's minimum USDT, which drops every sum in the range
     * from the offer whatever the book holds.
     *
     * Refused rather than clamped: a range silently narrowed to something the
     * product can serve is a range the user believes they asked for and did
     * not, and they would find out by never being called.
     *
     * Distinct from {@link WATCH_ABOVE_FIRST_DEPOSIT_LIMIT}, which is about
     * this *account* rather than about the range.
     */
    WATCH_RANGE_INVALID: {
      code: 2415,
      message: 'The requested amount range cannot be watched',
    },
    /**
     * The whole range sits above this account's first-deposit ceiling.
     *
     * Its own code rather than {@link ABOVE_FIRST_DEPOSIT_LIMIT}, which is
     * about reserving: this one is refused *before* anything exists to reserve,
     * and the sentence a client renders for it has to say "raise the cap first"
     * rather than "pick a different sum". Refusing beats accepting, because a
     * request that can never fire is a promise to call somebody who will never
     * be called.
     */
    WATCH_ABOVE_FIRST_DEPOSIT_LIMIT: {
      code: 2416,
      message: 'The requested amount range is above this account\'s first-deposit limit',
    },
  },
  /**
   * 2500 — the Transacto panel itself.
   *
   * Distinct from {@link ERROR.EXCHANGE_RATE} and `ERROR.FIAT_DEPOSIT`, which
   * are about a *price* and a *top-up*. This block is about the conversation:
   * the panel is a browser UI we drive with a session cookie, and when that
   * conversation breaks every product priced or settled through it stops at
   * once. Naming it separately is what lets an operator see one outage instead
   * of three unrelated-looking failures.
   */
  TRANSACTO_PANEL: {
    /** Unreachable, refusing our login, or still redirecting after a fresh one. */
    UNAVAILABLE: { code: 2500, message: 'The Transacto panel is unavailable' },
    /**
     * The panel answered, but its page no longer carries the CSRF token every
     * write needs.
     *
     * Its own error rather than an outage because the remedy is different and
     * the difference is not visible from the outside: nothing is down, their
     * markup changed under us, and no amount of retrying will help.
     */
    CSRF_UNAVAILABLE: { code: 2501, message: 'The Transacto panel did not yield a CSRF token' },
  },
} as const;

/** Shape of every leaf in {@link ERROR}, and of the body clients receive. */
export interface ApiError {
  readonly code: number;
  readonly message: string;
}
