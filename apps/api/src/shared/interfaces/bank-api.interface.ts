/**
 * The public endpoints of every bank this product reads, as they actually
 * answer.
 *
 * Each shape below was captured from a live call against a real jar, envelope
 * or moneybox — not inferred from what the code happened to read. That
 * distinction is the whole point: an interface that lists only the fields we
 * use looks complete, hides what else is on offer, and is indistinguishable
 * from one that is simply wrong. Monobank's jar record went two years declaring
 * `amount` and `goal` with an index signature over the rest, while `ownerName`
 * arrived on every scrape and nothing in the codebase knew it existed.
 *
 * **None of these needs authentication.** Everything here is public to anyone
 * holding the share link, which is why the Mini App can read a jar before a
 * terminal exists for it.
 *
 * **Several fields are payment credentials.** `PrivatEnvelopeInfo.card`,
 * `.iban` and `PrivatZipLinkPayload.to` are full card numbers and account
 * numbers. They must never reach a log line — the same rule the webhook module
 * follows for `cred`, and for the same reason.
 */

// --- Monobank ---------------------------------------------------------------

/**
 * `POST https://send.monobank.ua/api/handler`, body `{ c: 'hello', clientId }`.
 *
 * The jar page's own handshake. It is the only way to map a share link's short
 * `sendId` to the long `extJarId` that `api.monobank.ua` will accept, and it
 * answers with everything the page needs to render itself — including the
 * owner, the goal and the jar's status.
 */
export interface MonoJarHandshakeResponse {
  /** `jar` for a jar; the endpoint fronts other client types too. */
  clientType?: string
  /** The server half of the page's key exchange. Nothing here needs it. */
  Ps?: string
  /** What the owner called the jar — `title` on the record below. */
  name?: string
  /** The owner's avatar — `ownerIcon` on the record below. */
  avatar?: string
  /** ISO 4217 numeric, **as a string** here and as a number on the record. */
  currency?: string
  isReplenishable?: boolean
  /** The target in UAH kopecks; a jar targeting ₴1 000 reports 100000. */
  jarGoal?: number
  /** The long id, and the only one `api.monobank.ua/bank/jar` accepts. */
  extJarId?: string
  /**
   * The owner, masked to a first name and a surname initial — "Іван П.".
   *
   * PrivatBank masks the other way round, to a surname and an initial. Neither
   * is normalised to match the other: the difference belongs to the banks.
   */
  ownerName?: string
  /** `ACTIVE` for a jar that can still take money. */
  jarStatus?: string
  refererLink?: string
  jarType?: string
  /** The jar's own IBAN. A payment credential — never log it. */
  iban?: string
  isTrusted?: boolean
  caption?: string
  /** Monobank's own per-payment limits, in kopecks. */
  config?: {
    minAmount?: number
    maxAmount?: number
  }
  googleApplePay?: boolean
  /** Monobank's FX rates, shown on the payment page. Nothing here reads them. */
  rate?: {
    eur?: { buy?: number; sale?: number }
    usd?: { buy?: number; sale?: number }
  }
  /** Surcharge percent for a foreign card. */
  feeForeignCard?: number
  /** Present instead of `extJarId` when the jar cannot be identified. */
  errCode?: string
}

/**
 * `POST https://api.monobank.ua/bank/jar/<extJarId>`, empty body.
 *
 * The jar's public record, and where the scraper reads a balance. Amounts are
 * already kopecks, unlike PrivatBank's decimal strings and PUMB's offset
 * encoding.
 */
export interface MonoRawResponse {
  /** Current balance, in kopecks. */
  amount?: number
  /** The target, in kopecks. `0` when the jar has none. */
  goal?: number
  /** Masked, identically to the handshake's — "Іван П.". */
  ownerName?: string
  ownerIcon?: string
  /** What the owner called the jar. */
  title?: string
  description?: string
  /** The **short** id — the same `sendId` the share link carries. */
  jarId?: string
  /** ISO 4217 numeric — 980 is UAH. A number here, a string on the handshake. */
  currency?: number
  /** A charity jar. */
  blago?: boolean
  /** A closed jar can never receive a payment again. */
  closed?: boolean
}

// --- PrivatBank -------------------------------------------------------------

/**
 * `POST https://next.privat24.ua/api/p24/init?lang=ua&_=<ts>`.
 *
 * Step 1 of three. Opens an anonymous session: `data.xref` is the reference
 * every later call carries, and the matching `pubkey` arrives as a `Set-Cookie`
 * header rather than in the body.
 */
export interface PrivatInitResponse {
  status?: string
  data?: {
    /** The session reference. Everything downstream needs it. */
    xref?: string
    lang?: string
    base_url?: string
    session_type?: string
    /**
     * Empty on an anonymous session, which is the only kind we open. Declared
     * so it is clear they are empty rather than unmentioned.
     */
    phone?: string
    email?: string
    userName?: string
    userSurname?: string
    userPatronymic?: string
    /**
     * Several hundred fields of banners, tariffs, card artwork and FAQ copy for
     * the Privat24 web client, in three languages.
     *
     * **Deliberately left opaque**, and that is not the same as undeclared: it
     * is named, its size is stated, and the reason nothing reads it is that
     * none of it describes an envelope. Enumerating it would be transcription,
     * and it would go stale on Privat's next marketing change rather than on
     * any change that could affect us.
     */
    uiConfig?: Record<string, unknown>
  }
}

/** The inner `payload` of a ziplink's `data.value`. */
export interface PrivatZipLinkPayload {
  /** The envelope's card number. A payment credential — never log it. */
  to?: string
  /**
   * The owner, uppercased — "ПЕТРЕНКО І." — where `pubinfo` returns the same name
   * in title case. Both are masked to a surname and an initial.
   */
  fio?: string
  /** Currency code, e.g. `UAH`. */
  ccy?: string
  /** The envelope reference step 3 is addressed by. */
  refEnv?: string
}

/**
 * `POST https://next.privat24.ua/api/p24/pub/ziplink`.
 *
 * Step 2 of three — exchanges the share hash for the envelope reference.
 *
 * `data.value` is a **JSON string**, and its `payload` is sometimes a JSON
 * string again. `extractPrivatRefEnv` parses all three shapes rather than
 * reaching in with string surgery, which is why the type stops at `string`.
 */
export interface PrivatZipLinkResponse {
  task_id?: string
  status?: string
  data?: {
    /** JSON: `{ serviceId, payload }` — see {@link PrivatZipLinkPayload}. */
    value?: string
  }
}

/** The envelope itself, as `pubinfo` returns it. */
export interface PrivatEnvelopeInfo {
  /** What the owner called the envelope. */
  envName?: string
  envDescr?: string | null
  /** The target, as a decimal string in hryvnia: `"1000.00"`. */
  goalAmount?: string
  /**
   * Lifetime total ever deposited, in hryvnia — **not** the current balance,
   * and it does not fall when money is withdrawn. Confirmed against a live
   * envelope: withdrawing the whole balance left `deposit` at `"800.00"` while
   * `availableBalance` went to `"0.00"`.
   */
  deposit?: string
  /** The date the owner set as the goal's deadline, or `null`. */
  goalDate?: string | null
  /** Days left to {@link goalDate}, as a decimal string. `"0"` when there is none. */
  daysToGoal?: string
  /** The current balance, as a decimal string in hryvnia: `"0.00"`. */
  availableBalance?: string
  /** Of `availableBalance` against `goalAmount`, so it falls on a withdrawal. */
  goalCompletionPercentage?: number
  /** The envelope's artwork, a filename on Privat's CDN. */
  img?: string
  /** The envelope's own card number. A payment credential — never log it. */
  card?: string
  /** Masked owner: a surname and an initial — "Петренко І.". */
  ownerName?: string
  /** Currency code, e.g. `UAH`. */
  currency?: string
  /** The envelope's IBAN. A payment credential — never log it. */
  iban?: string
  /** `false` for a closed envelope, which can never be paid into again. */
  active?: boolean
}

/**
 * `POST https://widget.privat24.ua/api/p24/pub/envelopes/pubinfo`.
 *
 * Step 3 of three — the envelope's public record.
 */
export interface PrivatRawResponse {
  task_id?: string
  status?: string
  data: PrivatEnvelopeInfo
}

// --- PUMB -------------------------------------------------------------------

/**
 * `GET https://rlyeh2.payhub.com.ua/frames/donations/info?box_id=<id>&link_params={}`.
 *
 * A moneybox's public record.
 *
 * ⬜ **Not captured from a live call**, unlike every other shape in this file —
 * these three fields are what the adapter reads and no more. The index
 * signature is what an unverified contract looks like and is left in on
 * purpose, rather than pretending to a completeness this one does not have.
 * It is also why PUMB is the one bank whose moneybox owner we cannot name.
 */
export interface PumbRawResponse {
  /** Echoed back from the query — the moneybox's own id. */
  box_id?: string
  /**
   * The owner, as PUMB chooses to name them: `"Іван П."` — first name and a
   * surname initial. Their masking, not ours; not an identifier.
   */
  owner_name?: string
  /** What the moneybox is for, as its owner typed it. Free text. */
  goal?: string
  /** The owner's own description. Free text, and often empty. */
  description?: string
  /** `ACTIVE` for a moneybox that can still take money. */
  status?: string
  /** The short share link this box is reachable by — `mobile-app.pumb.ua/XXXXX`. */
  deep_link?: string
  /**
   * The balance, in kopecks.
   *
   * **Two encodings have been observed for this one field.** A capture from
   * September 2026 reports an empty box as plain `0`, while earlier ones
   * reported `-99999999999900` — an offset from a large negative constant, with
   * 35 UAH arriving as `-99999999996400`. `adaptPumbBalance` accepts both by
   * treating anything below a threshold as offset-encoded, which is why the
   * change did not break anything; it is documented here rather than tidied
   * away because the next change to it will not be so kind.
   */
  total_amount?: number
  /** The target, in kopecks. `80000` is a goal of ₴800. */
  amount?: number
  /** Google Analytics enabled for the frame. Nothing here reads it. */
  ga?: boolean
  /** Google Pay wiring for the payment frame. Nothing here reads it. */
  gpay?: {
    merchant_name?: string
    merchant_id?: string
    google_merchant_id?: string
  }
  /** Smallest single top-up the frame accepts, in kopecks. `1000` is ₴10. */
  min_amount?: number
  /** Largest single top-up the frame accepts, in kopecks. */
  max_amount?: number
  /**
   * The receiving card, **masked**: `"53552800****0000"`.
   *
   * Sixteen characters, twelve of them digits, in one observed sample. The name
   * is theirs and is left alone — it reads as "the card we hash", which is
   * presumably what their own backend does with it, but what arrives is a
   * masked PAN.
   *
   * This is the only partial disclosure any of the three banks makes, and the
   * whole reason a PUMB drop link can now be checked at creation. Matched with
   * `matchesMaskedCard`, never by slicing at fixed offsets.
   */
  card_to_hash?: string
  /** The receiving IBAN, in full. A payment credential — never log it. */
  iban?: string
  /**
   * Everything else PUMB sends.
   *
   * Kept, now that the fields above are captured rather than guessed, for the
   * one reason an index signature is ever honest: this response is somebody
   * else's and has already gained fields since it was first read.
   */
  [key: string]: unknown
}

// --- NovaPay ----------------------------------------------------------------

/**
 * `GET https://e-com.novapay.ua/case/<publicId>`, read out of the page.
 *
 * A NovaPay "Кейс" — their money box — publishes no JSON endpoint. The case
 * page is server-rendered and carries its entire state in a `window.__NOVA_DATA__`
 * literal, which is what `parseNovaPayCase` extracts. So the contract here is
 * HTML, in the same sense the Transacto panel's is: nothing about it is
 * promised, and a change to the page is silent.
 *
 * **Captured live** on 2026-09-04 from an open, targeted case with a zero
 * balance — every field below was present in that response and is declared
 * whether or not anything reads it. What that one capture cannot say is which
 * *other* values `type` and `status` take, so both are typed as strings and
 * compared against the one value each that is known.
 *
 * Two fields are payment credentials and must never reach a log line: `iban`,
 * and `recipientCode`, which is the recipient's taxpayer number.
 */
export interface NovaPayCaseData {
  /** The id in the share link — `/case/Er6QMUgswz`. */
  public_id: string
  /**
   * The target, as a decimal string in hryvnia: `"2000.00"`.
   *
   * Always a string, never a number, and always with two decimal places.
   * Ungrouped — `"6642.00"` on a live ₴6 642 case — with `formattedAmount`
   * carrying the grouped copy. **{@link balance} does not follow this rule**,
   * which is the single most surprising thing in this object.
   */
  amount: string
  /** `"targeted"` on a case with a goal. Other values not observed. */
  type: string
  /** `"opened"` on a case that can still be paid into. Other values not observed. */
  status: string
  /** What the owner called it. */
  name: string
  description: string
  /** The owner's own picture, or `null` for the default money-box artwork. */
  image: string | null
  /** The receiving IBAN, in full. A payment credential — never log it. */
  iban: string
  /** Whether this is a charitable fund rather than a personal case. */
  isFund: boolean
  /** How the NovaPay app is opened on this case from a browser. */
  deeplink: {
    type: string
    appsflyerUrl: string
    novapayMobileUrl: string
  }
  /**
   * Six-digit BINs of NovaPay's own cards, which the page uses to decide
   * whether a payer's card is one of theirs.
   *
   * Worth knowing rather than reading: the case's own card starts with one of
   * these — `400078` for the captured case — so they are a weak check on a
   * number parsed out of the sharing sentence.
   */
  novapayCardBins: string[]
  isAllowApplePay: boolean
  isAllowGooglePay: boolean
  /**
   * What NovaPay renders when the case is shared — and **the only place the
   * receiving card number appears**.
   *
   * `description` reads "Петренко Іван збирає Кейс. Закидуй гроші за номером:
   * 4000 7800 0000 3706. Закидуй гроші за посиланням https://…". The sixteen
   * digits are in no field of this object: it carries an IBAN and nothing else
   * that could be paid into from a card app. `adaptNovaPayCard` reads them out
   * of this sentence, which is prose in one language and the most fragile thing
   * in this file.
   */
  openGraphTags: {
    url: string
    title: string
    description: string
    image: string
    logo: string
  }
  /** Whether the page decided the visitor is on a phone. */
  isMobile: boolean
  /** `amount`, grouped for display: `"6 642.00"`, with a plain space. */
  formattedAmount: string
  /**
   * **Not** `balance` grouped — a different figure altogether.
   *
   * It read `"0.00"` on a live case whose {@link balance} was `"1 526.00"`. The
   * first capture had a zero balance, where the two are indistinguishable, and
   * this field was documented as the formatted copy on that basis. It is not;
   * what it actually counts is unknown, and nothing reads it.
   */
  formattedClosingBalance: string
  /** "Поповнення Кейсу «На тест»" — the payment's line item. */
  productsLabel: string
  /**
   * What has arrived so far, as a decimal string in hryvnia — **grouped once it
   * passes a thousand**, unlike {@link amount}.
   *
   * `"0.00"` in the first capture, `"1 526.00"` on the same case a day later
   * (verified live on 2026-09-05, with a plain U+0020 space). NovaPay groups
   * this raw field and not the raw target, so there is no rule to infer from one
   * to the other — and the first capture, taken at a zero balance where the
   * grouped and ungrouped forms are the same three characters, could not have
   * shown it.
   *
   * It cost real money before it was known: `parseFloat("1 526.00")` is `1`, so
   * a jar holding ₴1 526 reported ₴1 — which is not an error downstream, it is a
   * balance below the baseline, which is how the scraper recognises a
   * withdrawal. `adaptNovaPayBalance` now reads both forms and refuses anything
   * that is neither, rather than reading a figure part-way.
   */
  balance: string
  /** The case owner's full name, unmasked — "Петренко Іван". */
  owner: string
  recaptchaEnabled: boolean
  recaptchaSiteKey: string
  /** The payment's stated purpose, which repeats {@link productsLabel}. */
  purpose: string
  /** Who the money reaches. The same name as {@link owner} in the capture. */
  recipient: string
  /** The recipient's taxpayer number. Personal data — never log it. */
  recipientCode: string
  /** Whether a payer has to give their own taxpayer number to pay by card. */
  payerTaxpayerIdRequired: boolean
  theme: string
  appearance: string
  fonts: string[]
  cssLinks: string[]
}
